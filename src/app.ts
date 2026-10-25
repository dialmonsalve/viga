import express, { Router, type Application, type RequestHandler } from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { constants } from 'node:os';
import { contextMiddleware } from './context.ts';
import { resolveGuard, type Guard } from './decorators/use-guards.ts';
import { resolveInterceptor, type InterceptorRef } from './decorators/use-interceptors.ts';
import type { Injector, Token } from './di/injector.ts';
import {
  PROVIDER_INSTANCES,
  runDestroyHooks,
  runInitHooks,
  runServerCloseHooks,
  runServerListenHooks,
} from './di/lifecycle.ts';
import { loadApplication } from './di/module-loader.ts';
import {
  concealedNotFoundHandler,
  createErrorHandler,
  notFoundHandler,
} from './http/error-handler.ts';
import { CLIENT_IP, clientIpResolver } from './http/client-ip.ts';
import type { MessageResolver } from './http/messages.ts';
import {
  CONCEAL_ROUTES,
  mountController,
  normalizePath,
  type MountedRoute,
  type RoutePipeline,
} from './http/router.ts';
import { requestId, type RequestIdOptions } from './http/request-id.ts';
import { securityHeaders, type SecurityHeaders } from './http/security-headers.ts';
import { LOGGER, type Logger } from './logger.ts';
import type { AnyConstructor } from './metadata.ts';
import { diagnostic } from './diagnostics.ts';

export interface ServerTimeouts {
  headers?: number;
  request?: number;
  keepAlive?: number;
}

export interface AppOptions {
  rootModule: AnyConstructor;
  globalPrefix?: string;
  resolveMessage?: MessageResolver;
  logger?: Logger;
  bodyParser?: boolean;
  bodyLimit?: number | string;
  securityHeaders?: boolean | SecurityHeaders;
  requestId?: boolean | RequestIdOptions;
  trustProxy?: boolean | number | string | string[];
  timeouts?: ServerTimeouts;
  requireValidation?: boolean;
  concealRoutes?: boolean;
}

const DEFAULT_PORT = 3000;

const DEFAULT_TIMEOUTS: Required<ServerTimeouts> = {
  headers: 10_000,
  request: 30_000,
  keepAlive: 5_000,
};

interface Running {
  root: Injector;
}

export class App {
  readonly express: Application = express();
  readonly logger: Logger;
  private readonly rootModule: AnyConstructor;
  private readonly bodyParser: boolean;
  private readonly bodyLimit: number | string;
  private readonly securityHeaders: false | SecurityHeaders;
  private readonly requestId: false | RequestIdOptions;
  private readonly timeouts: Required<ServerTimeouts>;
  private readonly requireValidation: boolean;
  private readonly concealRoutes: boolean;
  private readonly resolveMessage?: MessageResolver;
  private readonly middlewares: RequestHandler[] = [];
  private readonly interceptors: InterceptorRef[] = [];
  private readonly initialized: unknown[] = [];
  private globalPrefix = '';
  private authGuard?: Guard;
  private running?: Running;
  private initializing?: Promise<Running>;
  private server?: Server;
  private closing?: Promise<void>;

  constructor(options: AppOptions) {
    this.rootModule = options.rootModule;
    this.logger = options.logger ?? console;
    this.bodyParser = options.bodyParser ?? true;
    this.bodyLimit = options.bodyLimit ?? '100kb';
    this.securityHeaders =
      options.securityHeaders === false
        ? false
        : options.securityHeaders === true ||
            options.securityHeaders === undefined
          ? {}
          : options.securityHeaders;
    this.requestId =
      options.requestId === false
        ? false
        : options.requestId === true || options.requestId === undefined
          ? {}
          : options.requestId;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
    this.requireValidation = options.requireValidation ?? false;
    this.concealRoutes = options.concealRoutes ?? false;
    this.resolveMessage = options.resolveMessage;
    this.express.disable('x-powered-by');
    if (options.trustProxy !== undefined)
      this.express.set('trust proxy', options.trustProxy);
    if (options.trustProxy === true) this.logger.warn(diagnostic('app.trustProxyAll'));
    if (options.globalPrefix) this.setGlobalPrefix(options.globalPrefix);
  }

  setGlobalPrefix(prefix: string) {
    this.assertNotStarted('setGlobalPrefix');
    this.globalPrefix = normalizePath(prefix).replace(/^\/$/, '');
    return this;
  }

  use(...middlewares: RequestHandler[]) {
    this.assertNotStarted('use');
    this.middlewares.push(...middlewares);
    return this;
  }

  useAuthGuard(guard: Guard) {
    this.assertNotStarted('useAuthGuard');
    this.authGuard = guard;
    return this;
  }

  useGlobalInterceptors(...interceptors: InterceptorRef[]) {
    this.assertNotStarted('useGlobalInterceptors');
    this.interceptors.push(...interceptors);
    return this;
  }

  async init() {
    this.initializing ??= this.start();
    await this.initializing;
    return this;
  }

  get<T>(token: Token<T>): T {
    if (!this.running) {
      throw new Error(diagnostic('app.getBeforeInit'));
    }
    return this.running.root.get(token);
  }

  async listen(port = DEFAULT_PORT, host?: string): Promise<Server> {
    await this.init();
    if (this.server) throw new Error(diagnostic('app.alreadyListening'));

    const server = createServer(this.express);
    server.headersTimeout = this.timeouts.headers;
    server.requestTimeout = this.timeouts.request;
    server.keepAliveTimeout = this.timeouts.keepAlive;
    await runServerListenHooks(this.initialized, server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;

    const { port: actualPort } = server.address() as AddressInfo;
    this.logger.info(
      diagnostic('app.listening', {
        port: actualPort,
        prefix: this.globalPrefix,
      })
    );
    return server;
  }

  close() {
    this.closing ??= this.stop();
    return this.closing;
  }

  enableShutdownHooks(
    signals: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT']
  ) {
    for (const signal of signals) {
      process.once(signal, () => {
        this.logger.info(diagnostic('app.signalReceived', { signal }));
        this.close()
          .then(
            () => {
              process.exitCode = 128 + constants.signals[signal];
            },
            (error: unknown) => {
              this.logger.error(diagnostic('app.closeFailed'), error);
              process.exitCode = 1;
            }
          )
          .finally(() => process.exit());
      });
    }
    return this;
  }

  private assertNotStarted(method: string) {
    if (this.initializing) {
      throw new Error(diagnostic('app.configureAfterStart', { method }));
    }
  }

  private async start(): Promise<Running> {
    const { controllers, injectors, root } = loadApplication(this.rootModule, {
      platformProviders: [
        { provide: LOGGER, useValue: this.logger },
        { provide: PROVIDER_INSTANCES, useValue: () => this.initialized },
        { provide: CONCEAL_ROUTES, useValue: this.concealRoutes },
        { provide: CLIENT_IP, useValue: clientIpResolver(this.express) },
      ],
    });

    const instances = [
      ...new Set(injectors.flatMap((injector) => injector.resolveAll())),
    ];
    await runInitHooks(instances, this.initialized);

    const pipeline: RoutePipeline = {
      authGuard: this.authGuard && resolveGuard(this.authGuard, root),
      interceptors: this.interceptors.map((ref) =>
        resolveInterceptor(ref, root)
      ),
      requireValidation: this.requireValidation,
    };

    const apiRouter = Router();
    const routes = controllers.flatMap(({ controller, injector }) =>
      mountController(apiRouter, controller, injector, pipeline)
    );
    this.reportRoutes(routes);

    this.express.use(contextMiddleware);
    if (this.requestId) this.express.use(requestId(this.requestId));
    if (this.securityHeaders)
      this.express.use(securityHeaders(this.securityHeaders));
    if (this.middlewares.length > 0) this.express.use(...this.middlewares);
    if (this.bodyParser) {
      this.express.use(express.json({ limit: this.bodyLimit }));
      this.express.use(
        express.urlencoded({ extended: false, limit: this.bodyLimit })
      );
    }
    this.express.use(this.globalPrefix || '/', apiRouter);
    this.express.use(
      this.concealRoutes
        ? concealedNotFoundHandler(pipeline.authGuard)
        : notFoundHandler
    );
    this.express.use(createErrorHandler(this.logger, this.resolveMessage));

    this.running = { root };
    return this.running;
  }

  private reportRoutes(routes: MountedRoute[]) {
    const publicRoutes = routes
      .filter((route) => route.isPublic)
      .map((route) => `${route.method.toUpperCase()} ${normalizePath(this.globalPrefix + route.path)}`);
    const privateCount = routes.length - publicRoutes.length;

    if (!this.authGuard && privateCount > 0) {
      this.logger.warn(diagnostic('app.noAuthGuard', { count: privateCount }));
    }
    if (publicRoutes.length > 0) {
      this.logger.debug(diagnostic('app.publicRoutes', { routes: publicRoutes.join(', ') }));
    }
  }

  private async stop() {
    const server = this.server;
    if (server) {
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
      await runServerCloseHooks(this.initialized).catch((error: unknown) =>
        this.logger.error(diagnostic('lifecycle.serverCloseFailed'), error)
      );
      await closed;
    }

    if (this.initializing) {
      await this.initializing.catch(() => undefined);
      await runDestroyHooks(this.initialized);
    }
  }
}

export function createApp(options: AppOptions) {
  return new App(options);
}
