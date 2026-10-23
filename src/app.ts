import express, { Router, type Application, type RequestHandler } from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { contextMiddleware } from './context.ts';
import { resolveGuard, type Guard } from './decorators/use-guards.ts';
import { resolveInterceptor, type InterceptorRef } from './decorators/use-interceptors.ts';
import type { Injector, Token } from './di/injector.ts';
import { runDestroyHooks, runInitHooks } from './di/lifecycle.ts';
import { loadApplication } from './di/module-loader.ts';
import { createErrorHandler, notFoundHandler } from './http/error-handler.ts';
import type { MessageResolver } from './http/messages.ts';
import { mountController, normalizePath, type RoutePipeline } from './http/router.ts';
import { LOGGER, type Logger } from './logger.ts';
import type { AnyConstructor } from './metadata.ts';
import { diagnostic } from './diagnostics.ts';

export interface AppOptions {
  rootModule: AnyConstructor;
  globalPrefix?: string;
  resolveMessage?: MessageResolver;
  logger?: Logger;
  bodyParser?: boolean;
}

interface Running {
  root: Injector;
  instances: unknown[];
}

export class App {
  readonly express: Application = express();
  readonly logger: Logger;
  private readonly rootModule: AnyConstructor;
  private readonly bodyParser: boolean;
  private readonly resolveMessage?: MessageResolver;
  private readonly middlewares: RequestHandler[] = [];
  private readonly interceptors: InterceptorRef[] = [];
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
    this.resolveMessage = options.resolveMessage;
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

  async listen(port: number, host?: string): Promise<Server> {
    await this.init();
    if (this.server) throw new Error(diagnostic('app.alreadyListening'));

    const server = createServer(this.express);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;

    const { port: actualPort } = server.address() as AddressInfo;
    this.logger.info(diagnostic('app.listening', { port: actualPort, prefix: this.globalPrefix }));
    return server;
  }

  close() {
    this.closing ??= this.stop();
    return this.closing;
  }

  enableShutdownHooks(signals: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT']) {
    for (const signal of signals) {
      process.once(signal, () => {
        this.logger.info(diagnostic('app.signalReceived', { signal }));
        this.close()
          .catch((error: unknown) => this.logger.error(diagnostic('app.closeFailed'), error))
          .finally(() => process.kill(process.pid, signal));
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
      platformProviders: [{ provide: LOGGER, useValue: this.logger }],
    });

    const instances = [...new Set(injectors.flatMap((injector) => injector.resolveAll()))];
    await runInitHooks(instances);

    const pipeline: RoutePipeline = {
      authGuard: this.authGuard && resolveGuard(this.authGuard, root),
      interceptors: this.interceptors.map((ref) => resolveInterceptor(ref, root)),
    };

    const apiRouter = Router();
    for (const { controller, injector } of controllers) {
      mountController(apiRouter, controller, injector, pipeline);
    }

    this.express.use(contextMiddleware);
    if (this.middlewares.length > 0) this.express.use(...this.middlewares);
    if (this.bodyParser) {
      this.express.use(express.json());
      this.express.use(express.urlencoded({ extended: false }));
    }
    this.express.use(this.globalPrefix || '/', apiRouter);
    this.express.use(notFoundHandler);
    this.express.use(createErrorHandler(this.logger, this.resolveMessage));

    this.running = { root, instances };
    return this.running;
  }

  private async stop() {
    const server = this.server;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
    }

    if (this.initializing) {
      const { instances } = await this.initializing;
      await runDestroyHooks(instances);
    }
  }
}

export function createApp(options: AppOptions) {
  return new App(options);
}
