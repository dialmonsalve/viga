---
title: 'Reference: optional modules'
description: Everything each optional viga module exports, with signatures and default values, from viga/config to viga/workers.
sidebar:
  order: 2
---

Everything you can import from each optional module. What you import from `viga` is in [its own reference](../core/).

## viga/config

[See the guide](../../optional/config/).

```ts
class ConfigModule {
  static forRoot(options: ConfigOptions): {
      new (): {};
  };
}

interface ConfigOptions {
  schema: StandardSchemaV1;
  env?: ConfigSource;
}

type ConfigSource = Readonly<Record<string, unknown>>;
```

`env` is `process.env` by default. `CONFIG` is the token with the validated configuration, of type `Config`, which comes from the schema you declare in the `Register` interface.

## viga/validation

[See the guide](../../optional/validation/).

| Decorator | What it does |
| --- | --- |
| `@Validate(schemas)` | Validates a route's `body`, `query` and `params`. |

```ts
class ValidationModule {
  static forRoot(options: ValidationOptions): {
      new (): {};
  };
}

interface ValidationOptions {
  formatIssue?: (issue: StandardSchemaV1.Issue) => string | undefined;
}

interface ValidationIssue {
  path: string;
  code?: string;
  message: string;
}
```

`VALIDATION_OPTIONS` is the options token, and `ValidationErrors` is the type of `details` in a validation error, with a list of `ValidationIssue` per part. `StandardSchemaV1` is re-exported.

## viga/testing

[See the guide](../../optional/testing/).

```ts
function createTestingApp(rootModule: AnyConstructor, { overrides, configure, ...options }?: TestingAppOptions): Promise<TestingApp>;

interface TestingAppOptions extends Omit<AppOptions, 'rootModule'> {
  overrides?: Provider[];
  configure?: (app: App) => void;
}

interface TestingApp {
  readonly app: App;
  url(path: string): string;
  request<T = unknown>(path: string, options?: TestingRequestOptions): Promise<TestingResponse<T>>;
  get<T>(token: Token<T>): T;
  close(): Promise<void>;
}

interface TestingRequestOptions {
  method?: string;
  json?: unknown;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
}

interface TestingResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}
```

## viga/pagination

[See the guide](../../optional/pagination/).

| Decorator | What it does |
| --- | --- |
| `@Paginate(options?)` | Reads `?page` and `?limit` and adds `page` to the context. |

| Option | Default |
| --- | --- |
| `defaultLimit` | `20` |
| `maxLimit` | `100` |
| `maxPage` | `1000` |
| `maxOffset` | `10000` |

```ts
interface PaginateOptions {
  defaultLimit?: number;
  maxLimit?: number;
  maxPage?: number;
  maxOffset?: number;
}

interface Page {
  readonly page: number;
  readonly limit: number;
  readonly offset: number;
  result<T>(items: readonly T[], total: number): PaginatedResult<T>;
}

interface PageContext<S extends RequestSchemas = RequestSchemas> extends HttpContext<S> {
  page: Page;
}

interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

interface PaginationMeta {
  total: number;
  page: number;
  lastPage: number;
  next: string | null;
  prev: string | null;
}
```

## viga/i18n

[See the guide](../../optional/i18n/).

```ts
class I18n {
  readonly locales: readonly string[];
  readonly defaultLocale: string;
  constructor({ catalogs, defaultLocale, resolveLocale }?: I18nOptions);
  readonly middleware: RequestHandler;
  readonly resolveMessage: MessageResolver;
  locale(): string;
  t(key: string, params?: MessageParams): string;
  match(preferences: string | readonly string[] | null | undefined): string | undefined;
  negotiate(acceptLanguage: string | readonly string[] | null | undefined): string;
  has(key: string): boolean;
  translate(locale: string, key: string, params?: MessageParams): string;
}

interface I18nOptions {
  catalogs?: Readonly<Record<string, Catalog>>;
  defaultLocale?: string;
  resolveLocale?: string | LocaleResolver;
}

type Catalog = {
  readonly [key: string]: string | Catalog;
};

type LocaleResolver = (req: Request) => string | readonly string[] | undefined;

function currentLocale(): string | undefined;
function runWithLocale<T>(locale: string, fn: () => T): T;
function negotiateLocale(preferences: string | readonly string[] | null | undefined, supported: readonly string[], fallback: string): string;
```

`diagnosticsEs` contains the [developer messages](../../optional/i18n/#developer-messages) in Spanish.

## viga/drizzle

[See the guide](../../optional/drizzle/).

| Decorator | What it does |
| --- | --- |
| `@Transactional(config?)` | Runs a method inside a transaction. |

```ts
class DrizzleModule {
  static forRoot(options: DrizzleOptions | (() => DrizzleOptions)): {
      new (): {};
  };
}

interface DrizzleOptions {
  connection: string | PoolConfig;
  schema?: Record<string, unknown>;
}

class DatabaseService implements OnModuleDestroy {
  readonly root: Database;
  get db(): Executor;
  inTransaction(): boolean;
  transaction<T>(work: (tx: Transaction) => Promise<T>, config?: TransactionConfig): Promise<T>;
  ping(): Promise<void>;
}
```

`DatabaseService` also exposes `pool`, the `pg` `Pool`. `DRIZZLE_OPTIONS` is the options token. `Register` is the interface where you declare your schema, and `RegisteredSchema` is the resulting type. `Database`, `Executor`, `Transaction` and `TransactionConfig` are Drizzle types with that schema.

## viga/websocket

[See the guide](../../optional/websocket/).

| Decorator | Goes on | What it does |
| --- | --- | --- |
| `@Gateway(path)` | Class | Declares a gateway. |
| `@OnMessage(event, schema?)` | Method | Handles an event. |
| `@RateLimit(options)` | Class or method | Limits messages. It's different from `RateLimit` in `viga`. |

```ts
class WebSocketModule {
  static forRoot(options?: WebSocketOptions | (() => WebSocketOptions)): {
      new (): {};
  };
}

interface WebSocketOptions {
  adapter?: WsAdapter;
  authenticate?: WsAuthenticate;
  allowedOrigins?: readonly string[] | ((origin: string) => boolean);
  maxPayload?: number;
  maxBufferedBytes?: number;
  maxRoomsPerClient?: number;
  handshakeTimeoutMs?: number;
  maxConnections?: number;
  maxPendingHandshakes?: number;
  connectionsPerKey?: WsConnectionsPerKey | false;
  heartbeatMs?: number;
  messageRateLimit?: WsMessageRateLimit | false;
  requireValidation?: boolean;
  resolveMessage?: MessageResolver;
  i18n?: I18n;
  resolveLocale?: string | WsLocaleResolver;
}

type WsAuthenticate = (req: IncomingMessage) => boolean | Record<string, unknown> | Promise<boolean | Record<string, unknown>>;
type WsLocaleResolver = (req: IncomingMessage) => string | readonly string[] | null | undefined;

interface WsConnectionsPerKey {
  max: number;
  key?: (req: IncomingMessage) => string | undefined;
}

interface WsMessageRateLimit {
  max: number;
  windowMs: number;
}

interface WsRateLimitOptions {
  max: number;
  windowMs: number;
  key?: (ctx: WsContext) => string;
  store?: RateLimitStore;
}
```

The default values are in [Default limits](../../optional/websocket/#default-limits). `WEBSOCKET_OPTIONS` is the options token.

```ts
class WsServer implements OnServerListen, OnServerClose {
  get clients(): ReadonlySet<WsClient>;
  to(room: string): WsBroadcast;
  broadcast(event: string, data?: unknown, options?: WsBroadcastOptions): void;
}

interface WsBroadcast {
  send(event: string, data?: unknown, options?: WsBroadcastOptions): void;
}

interface WsBroadcastOptions {
  except?: WsClient;
}

interface WsClient {
  readonly id: string;
  readonly state: Record<string, unknown>;
  readonly rooms: ReadonlySet<string>;
  readonly locale: string | undefined;
  readonly expiresAt: number | undefined;
  expireAt(at: Date | number | undefined): void;
  send(event: string, data?: unknown): void;
  join(room: string): void;
  leave(room: string): void;
  close(code?: number, reason?: string): void;
}

interface WsContext<S extends StandardSchemaV1 | undefined = undefined> {
  client: WsClient;
  req: IncomingMessage;
  event: string;
  data: InferData<S>;
}

interface OnWsConnection {
  onConnection(client: WsClient): unknown;
}

interface OnWsDisconnect {
  onDisconnect(client: WsClient, code: number, reason: string): unknown;
}
```

To write [another adapter](../../optional/websocket/#other-adapters):

```ts
function createWsAdapter(): WsAdapter;

interface WsAdapter {
  attach(server: Server, options: WsAdapterOptions): void | Promise<void>;
  close(): void | Promise<void>;
}

interface WsAdapterOptions {
  paths: readonly string[];
  maxPayload: number;
  heartbeatMs: number;
  verify(req: IncomingMessage): Promise<WsVerdict>;
  onConnection(connection: WsConnection, req: IncomingMessage): void;
}

interface WsConnection {
  readonly bufferedAmount: number;
  send(message: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  onMessage(listener: (message: string, isBinary: boolean) => void): void;
  onClose(listener: (code: number, reason: string) => void): void;
}
```

`WsVerdict` is the decision on a handshake: `accept`, `reject` with a `status`, or `ignore`.

## viga/health

[See the guide](../../optional/health/).

```ts
class HealthModule {
  static forRoot(options?: HealthOptions | (() => HealthOptions), { path, readyPath }?: HealthRoutes): {
      new (): {};
  };
}

interface HealthOptions {
  checks?: Record<string, HealthCheck>;
  timeoutMs?: number;
  cacheMs?: number;
}

interface HealthRoutes {
  path?: string;
  readyPath?: string;
}

type HealthCheck = () => unknown;

class HealthService {
  isReady(): Promise<boolean>;
}
```

By default, `timeoutMs` is `3_000`, `cacheMs` is `1_000`, `path` is `'/health'` and `readyPath` is `'/ready'`. `HEALTH_OPTIONS` is the options token.

## viga/crypto

[See the guide](../../optional/crypto/).

```ts
function hashPassword(password: string): Promise<string>;
function verifyPassword(password: string, stored: string): Promise<boolean>;
function needsRehash(stored: string): boolean;
function randomToken(bytes?: number): string;
function hashToken(token: string): string;
function safeEqual(a: string, b: string): boolean;
```

`randomToken` generates 32 bytes by default.

| Decorator | What it does |
| --- | --- |
| `@Signed()` | Requires a valid signed URL. |

```ts
class CryptoModule {
  static forRoot(options: CryptoOptions | (() => CryptoOptions)): {
      new (): {};
  };
}

interface CryptoOptions {
  signingKeys?: readonly string[];
  encryption?: EncryptionOptions;
}

interface EncryptionOptions {
  active: string;
  keys: Record<string, string>;
}

class UrlSigner {
  sign(path: string, { expiresInSeconds, method }: SignUrlOptions): string;
  verify(path: string, { method }?: VerifyUrlOptions): boolean;
}

interface SignUrlOptions {
  expiresInSeconds: number;
  method?: string;
}

interface VerifyUrlOptions {
  method?: string;
}

class Encryptor {
  encrypt(plaintext: string, { context }?: EncryptOptions): string;
  decrypt(encrypted: string, { context }?: EncryptOptions): string;
}

interface EncryptOptions {
  context?: string;
}
```

`CRYPTO_OPTIONS` is the options token.

## viga/events

[See the guide](../../optional/events/).

| Decorator | What it does |
| --- | --- |
| `@OnEvent(Event)` | Runs the method when that event is emitted. |

```ts
class EventsModule {
  static forRoot(options?: EventsOptions): {
      new (): {};
  };
}

interface EventsOptions {
  drainTimeoutMs?: number;
}

class EventBus implements OnDrain {
  emit(event: object): Promise<void>;
}
```

`drainTimeoutMs` is `10_000` by default. `EVENTS_OPTIONS` is the options token.

## viga/workers

[See the guide](../../optional/workers/).

```ts
function startWorker(rootModule: AnyConstructor, { key, orphanTimeoutMs, ...options }?: StartWorkerOptions): Promise<App>;

interface StartWorkerOptions extends Omit<AppOptions, 'rootModule'> {
  key?: string;
  orphanTimeoutMs?: number;
}

class WorkerModule {
  static forKey(key: string): {
      new (): {};
  };
}

class WorkersModule {
  static forRoot(options: WorkersOptions | (() => WorkersOptions)): {
      new (): {};
  };
}

interface WorkersOptions {
  entry: string | URL;
  keys?: readonly string[] | (() => readonly string[] | Promise<readonly string[]>);
  maxWorkers?: number;
  stopTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  execArgv?: readonly string[];
}

class WorkerSupervisor implements OnModuleInit, OnDrain {
  start(key: string): Promise<void>;
  stop(key: string): Promise<void>;
  list(): WorkerStatus[];
}

interface WorkerStatus {
  key: string;
  status: 'running' | 'restarting' | 'stopping';
  pid: number | undefined;
  restarts: number;
}
```

By default, `key` is `process.argv[2]`, `orphanTimeoutMs` is `30_000`, `maxWorkers` is `8` and `stopTimeoutMs` is `30_000`. `WORKER_KEY` is the token with the current worker's key, and `WORKERS_OPTIONS` the options token.

## viga/upload

[See the guide](../../optional/upload/).

| Decorator | What it does |
| --- | --- |
| `@Upload(options)` | Receives files on a route and adds `file` and `files` to the context. |

```ts
interface UploadOptions {
  field: string;
  types?: readonly string[];
  check?: (file: UploadedFile) => boolean | Promise<boolean>;
  maxFileSize?: number;
  maxFiles?: number;
  maxFields?: number;
  maxFieldSize?: number;
  optional?: boolean;
}

type UploadContext<S extends RequestSchemas = RequestSchemas> = HttpContext<S> & {
  file: UploadedFile;
  files: UploadedFile[];
};

type OptionalUploadContext<S extends RequestSchemas = RequestSchemas> = HttpContext<S> & {
  file: UploadedFile | undefined;
  files: UploadedFile[];
};

interface UploadedFile {
  readonly field: string;
  readonly originalName: string;
  readonly size: number;
  readonly path: string;
  readonly type: string | undefined;
  readonly extension: string | undefined;
  moveTo(destination: string): Promise<void>;
}
```

The default values are in [Limits](../../optional/upload/#limits).
