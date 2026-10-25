import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { runInNewContext } from '../context.ts';
import { runWithLocale } from '../i18n/i18n.ts';
import { Injectable } from '../decorators/injectable.ts';
import { validatedParts } from '../decorators/pipeline.ts';
import { resolveGuard, runGuards, type GuardFn } from '../decorators/use-guards.ts';
import {
  resolveInterceptor,
  runInterceptors,
  type InterceptorFn,
} from '../decorators/use-interceptors.ts';
import { inject, injectorOf } from '../di/injector.ts';
import { PROVIDER_INSTANCES, type OnServerClose, type OnServerListen } from '../di/lifecycle.ts';
import { diagnostic } from '../diagnostics.ts';
import { describeException, toHttpException } from '../http/error-handler.ts';
import {
  BadRequestException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '../http/exceptions.ts';
import { CLIENT_IP } from '../http/client-ip.ts';
import { ipKey } from '../http/ip.ts';
import { secondsUntil } from '../http/rate-limit.ts';
import { DEFAULT_MESSAGES } from '../http/messages.ts';
import { CONCEAL_ROUTES, normalizePath } from '../http/router.ts';
import { LOGGER } from '../logger.ts';
import type { AnyConstructor } from '../metadata.ts';
import type { WsConnection, WsVerdict } from './adapter.ts';
import { tooManyMessages } from './errors.ts';
import {
  readGatewayDefinition,
  type OnWsConnection,
  type OnWsDisconnect,
  type WsClient,
  type WsContext,
} from './gateway.ts';
import {
  WEBSOCKET_OPTIONS,
  type ResolvedWebSocketOptions,
  type WsMessageRateLimit,
} from './options.ts';

const EVENT_NAME = /^[\w.:-]{1,128}$/;
const MESSAGE_ID = /^[\w-]{1,64}$/;
const POLICY_VIOLATION = 1008;
const INTERNAL_ERROR = 1011;

type MessageId = string | number;

interface Envelope {
  event: string;
  data: unknown;
  id?: MessageId;
}

interface Route {
  gateway: Partial<OnWsConnection & OnWsDisconnect>;
  isPublic: boolean;
  guards: GuardFn<WsContext>[];
  interceptors: InterceptorFn<WsContext>[];
  handlers: Map<string, (ctx: WsContext) => unknown>;
}

interface Slot {
  settle(): void;
  release(): void;
}

interface Handshake {
  route: Route;
  state: Record<string, unknown>;
  slot: Slot;
}

export interface WsBroadcastOptions {
  except?: WsClient;
}

export interface WsBroadcast {
  send(event: string, data?: unknown, options?: WsBroadcastOptions): void;
}

function serialize(event: string, data: unknown, id?: MessageId) {
  return JSON.stringify({
    event,
    ...(data === undefined ? {} : { data }),
    ...(id === undefined ? {} : { id }),
  });
}

function isMessageId(value: unknown): value is MessageId {
  return (
    (typeof value === 'string' && MESSAGE_ID.test(value)) ||
    (typeof value === 'number' && Number.isSafeInteger(value))
  );
}

function parseEnvelope(message: string): Envelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    throw new BadRequestException();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestException();
  }

  const { event, data, id } = parsed as Record<string, unknown>;
  if (typeof event !== 'string' || !EVENT_NAME.test(event)) throw new BadRequestException();
  if (id !== undefined && !isMessageId(id)) throw new BadRequestException();
  return { event, data, ...(id === undefined ? {} : { id }) };
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<AsyncIterable<unknown>>)[Symbol.asyncIterator] === 'function'
  );
}

function pathOf(req: IncomingMessage) {
  try {
    return normalizePath(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    return undefined;
  }
}

class Rooms {
  private readonly members = new Map<string, Set<Client>>();

  join(client: Client, room: string) {
    let clients = this.members.get(room);
    if (!clients) {
      clients = new Set();
      this.members.set(room, clients);
    }
    clients.add(client);
    client.rooms.add(room);
  }

  leave(client: Client, room: string) {
    const clients = this.members.get(room);
    clients?.delete(client);
    if (clients?.size === 0) this.members.delete(room);
    client.rooms.delete(room);
  }

  leaveAll(client: Client) {
    for (const room of [...client.rooms]) this.leave(client, room);
  }

  of(room: string): ReadonlySet<Client> {
    return this.members.get(room) ?? new Set();
  }
}

type ClientLimits = Pick<ResolvedWebSocketOptions, 'maxBufferedBytes' | 'maxRoomsPerClient'>;

class Client implements WsClient {
  readonly id = randomUUID();
  readonly rooms = new Set<string>();
  private open = true;
  private hits = 0;
  private windowEndsAt = 0;

  constructor(
    readonly state: Record<string, unknown>,
    readonly locale: string | undefined,
    private readonly connection: WsConnection,
    private readonly roomRegistry: Rooms,
    private readonly limits: ClientLimits
  ) {}

  get isOpen() {
    return this.open;
  }

  send(event: string, data?: unknown) {
    this.deliver(serialize(event, data));
  }

  deliver(message: string) {
    if (!this.open) return;
    if (this.connection.bufferedAmount > this.limits.maxBufferedBytes) {
      this.connection.terminate();
      return;
    }
    this.connection.send(message);
  }

  join(room: string) {
    if (!this.open || this.rooms.has(room)) return;
    const max = this.limits.maxRoomsPerClient;
    if (this.rooms.size >= max) {
      throw new BadRequestException('errors.tooManyRooms', undefined, { max });
    }
    this.roomRegistry.join(this, room);
  }

  leave(room: string) {
    this.roomRegistry.leave(this, room);
  }

  close(code?: number, reason?: string) {
    this.connection.close(code, reason);
  }

  markClosed() {
    this.open = false;
    this.roomRegistry.leaveAll(this);
  }

  consume(limit: WsMessageRateLimit | false) {
    if (!limit) return;
    const now = Date.now();
    if (now >= this.windowEndsAt) {
      this.hits = 0;
      this.windowEndsAt = now + limit.windowMs;
    }
    this.hits++;
    if (this.hits > limit.max) throw tooManyMessages(secondsUntil(this.windowEndsAt));
  }
}

@Injectable()
export class WsServer implements OnServerListen, OnServerClose {
  private readonly options = inject(WEBSOCKET_OPTIONS);
  private readonly instances = inject(PROVIDER_INSTANCES);
  private readonly logger = inject(LOGGER);
  private readonly concealRoutes = inject(CONCEAL_ROUTES);
  private readonly clientIp = inject(CLIENT_IP);
  private readonly rooms = new Rooms();
  private readonly connected = new Set<Client>();
  private readonly handshakes = new WeakMap<IncomingMessage, Handshake>();
  private readonly perKey = new Map<string, number>();
  private pending = 0;
  private warnedForwardedFor = false;
  private routes = new Map<string, Route>();
  private attached = false;

  get clients(): ReadonlySet<WsClient> {
    return this.connected;
  }

  to(room: string): WsBroadcast {
    return {
      send: (event, data, options) => this.deliver(this.rooms.of(room), event, data, options),
    };
  }

  broadcast(event: string, data?: unknown, options?: WsBroadcastOptions) {
    this.deliver(this.connected, event, data, options);
  }

  async onServerListen(server: Server) {
    this.routes = this.buildRoutes();
    if (this.routes.size === 0) return;
    this.reportGateways();

    await this.options.adapter.attach(server, {
      paths: [...this.routes.keys()],
      maxPayload: this.options.maxPayload,
      heartbeatMs: this.options.heartbeatMs,
      verify: (req) => this.verify(req),
      onConnection: (connection, req) => this.connect(connection, req),
    });
    this.attached = true;
  }

  async onServerClose() {
    if (this.attached) await this.options.adapter.close();
  }

  private deliver(
    clients: ReadonlySet<Client>,
    event: string,
    data: unknown,
    { except }: WsBroadcastOptions = {}
  ) {
    const message = serialize(event, data);
    for (const client of [...clients]) {
      if (client !== except) client.deliver(message);
    }
  }

  private buildRoutes() {
    const routes = new Map<string, Route>();
    const names = new Map<string, string>();

    for (const instance of this.instances()) {
      if (typeof instance !== 'object' || instance === null) continue;
      const Gateway = instance.constructor as AnyConstructor;
      const definition = readGatewayDefinition(Gateway);
      if (!definition) continue;

      const existing = names.get(definition.path);
      if (existing) {
        throw new Error(
          diagnostic('ws.duplicatePath', {
            first: existing,
            second: Gateway.name,
            path: definition.path,
          })
        );
      }

      const injector = injectorOf(instance);
      const target = instance as Record<PropertyKey, unknown>;
      const handlers = new Map<string, (ctx: WsContext) => unknown>();

      for (const { event, handlerName } of definition.handlers) {
        if (handlers.has(event)) {
          throw new Error(diagnostic('ws.duplicateEvent', { gateway: Gateway.name, event }));
        }
        const method = target[handlerName] as (ctx: WsContext) => unknown;
        if (this.options.requireValidation && !validatedParts(method).has('data')) {
          throw new Error(
            diagnostic('ws.missingValidation', {
              gateway: Gateway.name,
              method: String(handlerName),
              event,
            })
          );
        }
        handlers.set(event, (ctx) => method.call(instance, ctx));
      }

      names.set(definition.path, Gateway.name);
      routes.set(definition.path, {
        gateway: instance as Route['gateway'],
        isPublic: definition.isPublic,
        guards: definition.guards.map((guard) => resolveGuard(guard, injector)),
        interceptors: definition.interceptors.map((ref) => resolveInterceptor(ref, injector)),
        handlers,
      });
    }
    return routes;
  }

  private reportGateways() {
    const publicPaths = [...this.routes].filter(([, route]) => route.isPublic).map(([path]) => path);
    const privateCount = this.routes.size - publicPaths.length;

    if (!this.options.authenticate && privateCount > 0) {
      this.logger.warn(diagnostic('ws.noAuthenticate', { count: privateCount }));
    }
    if (publicPaths.length > 0) {
      this.logger.debug(diagnostic('ws.publicGateways', { paths: publicPaths.join(', ') }));
    }
  }

  private isFull() {
    return this.connected.size + this.pending >= this.options.maxConnections;
  }

  private keyOf(req: IncomingMessage) {
    const limit = this.options.connectionsPerKey;
    if (!limit) return undefined;
    if (limit.key) return limit.key(req);

    const socketIp = req.socket.remoteAddress;
    const ip = this.clientIp(req) ?? socketIp;
    if (!this.warnedForwardedFor && req.headers['x-forwarded-for'] !== undefined && ip === socketIp) {
      this.warnedForwardedFor = true;
      this.logger.warn(diagnostic('ws.untrustedForwardedFor'));
    }
    return ip === undefined ? undefined : ipKey(ip);
  }

  private reserve(key: string | undefined, req: IncomingMessage): Slot {
    this.pending++;
    this.track(key, 1);
    let pending = true;
    let held = true;

    const slot: Slot = {
      settle: () => {
        if (!pending) return;
        pending = false;
        this.pending--;
        req.socket.off('close', slot.release);
      },
      release: () => {
        slot.settle();
        if (!held) return;
        held = false;
        this.track(key, -1);
      },
    };
    req.socket.once('close', slot.release);
    return slot;
  }

  private isKeyFull(key: string | undefined) {
    const limit = this.options.connectionsPerKey;
    return limit && key !== undefined && (this.perKey.get(key) ?? 0) >= limit.max;
  }

  private track(key: string | undefined, delta: 1 | -1) {
    if (key === undefined) return;
    const count = (this.perKey.get(key) ?? 0) + delta;
    if (count > 0) this.perKey.set(key, count);
    else this.perKey.delete(key);
  }

  private isAllowedOrigin(origin: string) {
    const { allowedOrigins } = this.options;
    return typeof allowedOrigins === 'function'
      ? allowedOrigins(origin)
      : allowedOrigins.includes(origin);
  }

  private async verify(req: IncomingMessage): Promise<WsVerdict> {
    const path = pathOf(req);
    const route = path === undefined ? undefined : this.routes.get(path);
    if (!route && !this.concealRoutes) return { action: 'ignore' };
    if (this.pending >= this.options.maxPendingHandshakes) {
      return route ? { action: 'reject', status: 503 } : { action: 'ignore', status: 503 };
    }
    if (!route) return this.concealed(req);
    if (this.isFull()) return { action: 'reject', status: 503 };
    const key = this.keyOf(req);
    if (this.isKeyFull(key)) return { action: 'reject', status: 429 };
    if (this.hasForbiddenOrigin(req)) return { action: 'reject', status: 403 };

    const slot = this.reserve(key, req);
    let state: Record<string, unknown> = {};
    if (!route.isPublic) {
      const auth = await this.checkAuthentication(req);
      if ('status' in auth) {
        slot.release();
        return { action: 'reject', status: auth.status };
      }
      state = auth.state;
    }

    this.handshakes.set(req, { route, state, slot });
    return { action: 'accept' };
  }

  private async concealed(req: IncomingMessage): Promise<WsVerdict> {
    if (this.hasForbiddenOrigin(req)) return { action: 'ignore', status: 403 };
    this.pending++;
    try {
      const auth = await this.checkAuthentication(req);
      return { action: 'ignore', status: 'status' in auth ? auth.status : 404 };
    } finally {
      this.pending--;
    }
  }

  private hasForbiddenOrigin(req: IncomingMessage) {
    const { origin } = req.headers;
    return origin !== undefined && !this.isAllowedOrigin(origin);
  }

  private async checkAuthentication(
    req: IncomingMessage
  ): Promise<{ status: number } | { state: Record<string, unknown> }> {
    try {
      const result = await this.authenticate(req);
      if (!result) return { status: 401 };
      return { state: typeof result === 'object' ? { ...result } : {} };
    } catch (error) {
      const exception = toHttpException(error);
      if (exception.statusCode >= 500 && !(error instanceof ServiceUnavailableException)) {
        this.logger.error(diagnostic('ws.unhandledException'), error);
      }
      return { status: exception.statusCode };
    }
  }

  private async authenticate(req: IncomingMessage) {
    const { authenticate, handshakeTimeoutMs } = this.options;
    if (!authenticate) return undefined;

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        this.logger.warn(diagnostic('ws.handshakeTimeout', { ms: handshakeTimeoutMs }));
        reject(new ServiceUnavailableException());
      }, handshakeTimeoutMs);
    });

    try {
      return await Promise.race([Promise.resolve().then(() => authenticate(req)), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private connect(connection: WsConnection, req: IncomingMessage) {
    const handshake = this.handshakes.get(req);
    this.handshakes.delete(req);
    if (!handshake) {
      connection.close(INTERNAL_ERROR);
      return;
    }
    const { route, state, slot } = handshake;
    slot.settle();

    const client = new Client(state, this.localeOf(req), connection, this.rooms, this.options);
    this.connected.add(client);

    const ready = this.inContext(client, async () => route.gateway.onConnection?.(client))
      .then(
        () => true,
        (error: unknown) => {
          this.closeAfterFailure(client, error);
          return false;
        }
      );

    connection.onMessage((message, isBinary) => {
      void ready.then((ok) => {
        if (ok) return this.receive(route, client, req, message, isBinary);
      });
    });

    connection.onClose((code, reason) => {
      client.markClosed();
      this.connected.delete(client);
      slot.release();
      void ready.then(async (ok) => {
        if (!ok) return;
        try {
          await this.inContext(client, async () =>
            route.gateway.onDisconnect?.(client, code, reason)
          );
        } catch (error) {
          this.logger.error(diagnostic('ws.unhandledException'), error);
        }
      });
    });
  }

  private closeAfterFailure(client: Client, error: unknown) {
    if (error instanceof HttpException && error.statusCode < 500) {
      client.close(POLICY_VIOLATION);
      return;
    }
    this.logger.error(diagnostic('ws.unhandledException'), error);
    client.close(INTERNAL_ERROR);
  }

  private localeOf(req: IncomingMessage) {
    const { i18n, resolveLocale } = this.options;
    if (!i18n) return undefined;
    const preferred =
      typeof resolveLocale === 'string'
        ? req.headers[resolveLocale.toLowerCase()]
        : resolveLocale?.(req);
    return i18n.match(preferred) ?? i18n.negotiate(req.headers['accept-language']);
  }

  private inContext<T>(client: Client, fn: () => Promise<T>): Promise<T> {
    const { locale } = client;
    return runInNewContext(() => (locale === undefined ? fn() : runWithLocale(locale, fn)));
  }

  private receive(
    route: Route,
    client: Client,
    req: IncomingMessage,
    message: string,
    isBinary: boolean
  ) {
    return this.inContext(client, () => this.handle(route, client, req, message, isBinary));
  }

  private async handle(
    route: Route,
    client: Client,
    req: IncomingMessage,
    message: string,
    isBinary: boolean
  ) {
    let id: MessageId | undefined;
    try {
      client.consume(this.options.messageRateLimit);
      if (isBinary) throw new UnsupportedMediaTypeException();

      const envelope = parseEnvelope(message);
      id = envelope.id;
      const handler = route.handlers.get(envelope.event);
      if (!handler) throw new NotFoundException();

      const ctx: WsContext = { client, req, event: envelope.event, data: envelope.data };
      await runGuards(route.guards, ctx);
      const result = await runInterceptors(route.interceptors, ctx, async () => handler(ctx));

      if (isAsyncIterable(result)) {
        for await (const item of result) {
          if (!client.isOpen) break;
          client.deliver(serialize(envelope.event, item, id));
        }
      } else if (result !== undefined) {
        client.deliver(serialize(envelope.event, result, id));
      }
    } catch (error) {
      this.replyError(client, req, error, id);
    }
  }

  private replyError(client: Client, req: IncomingMessage, error: unknown, id?: MessageId) {
    const exception = toHttpException(error);
    if (exception.statusCode >= 500) {
      this.logger.error(diagnostic('ws.unhandledException'), error);
    }

    try {
      const { code, message } = describeException(
        exception,
        req as Request,
        this.options.resolveMessage
      );
      const { statusCode, details } = exception;
      client.deliver(
        serialize(
          'error',
          { statusCode, code, message, ...(details === undefined ? {} : { details }) },
          id
        )
      );
    } catch (failure) {
      this.logger.error(diagnostic('ws.unhandledException'), failure);
      client.deliver(
        serialize(
          'error',
          { statusCode: 500, code: 'errors.internal', message: DEFAULT_MESSAGES['errors.internal'] },
          id
        )
      );
    }
  }
}
