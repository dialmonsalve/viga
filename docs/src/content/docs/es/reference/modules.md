---
title: 'Referencia: módulos opcionales'
description: Todo lo que exporta cada módulo opcional de viga, con sus firmas y valores por defecto, de viga/config a viga/workers.
sidebar:
  order: 2
---

Todo lo que puedes importar desde cada módulo opcional. Lo que importas desde `viga` está en [su propia referencia](../core/).

## viga/config

[Ver la guía](../../optional/config/).

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

`env` es `process.env` por defecto. `CONFIG` es el token con la configuración validada, de tipo `Config`, que sale del esquema que declares en la interfaz `Register`.

## viga/validation

[Ver la guía](../../optional/validation/).

| Decorador | Qué hace |
| --- | --- |
| `@Validate(schemas)` | Valida `body`, `query` y `params` de una ruta. |

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

`VALIDATION_OPTIONS` es el token de las opciones, y `ValidationErrors` el tipo de `details` en un error de validación, con una lista de `ValidationIssue` por cada parte. `StandardSchemaV1` se reexporta.

## viga/testing

[Ver la guía](../../optional/testing/).

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

[Ver la guía](../../optional/pagination/).

| Decorador | Qué hace |
| --- | --- |
| `@Paginate(options?)` | Lee `?page` y `?limit` y añade `page` al contexto. |

| Opción | Por defecto |
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

[Ver la guía](../../optional/i18n/).

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

`diagnosticsEs` contiene los [mensajes para desarrolladores](../../optional/i18n/#mensajes-para-desarrolladores) en español.

## viga/drizzle

[Ver la guía](../../optional/drizzle/).

| Decorador | Qué hace |
| --- | --- |
| `@Transactional(config?)` | Ejecuta un método dentro de una transacción. |

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

`DatabaseService` también expone `pool`, el `Pool` de `pg`. `DRIZZLE_OPTIONS` es el token de las opciones. `Register` es la interfaz donde declaras tu esquema, y `RegisteredSchema` el tipo que resulta. `Database`, `Executor`, `Transaction` y `TransactionConfig` son tipos de Drizzle con ese esquema.

## viga/websocket

[Ver la guía](../../optional/websocket/).

| Decorador | Se pone en | Qué hace |
| --- | --- | --- |
| `@Gateway(path)` | Clase | Declara un gateway. |
| `@OnMessage(event, schema?)` | Método | Atiende un evento. |
| `@RateLimit(options)` | Clase o método | Limita los mensajes. Es distinto del `RateLimit` de `viga`. |

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

Los valores por defecto están en [Límites por defecto](../../optional/websocket/#límites-por-defecto). `WEBSOCKET_OPTIONS` es el token de las opciones.

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

Para escribir [otro adaptador](../../optional/websocket/#otros-adaptadores):

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

`WsVerdict` es la decisión sobre un handshake: `accept`, `reject` con un `status`, o `ignore`.

## viga/health

[Ver la guía](../../optional/health/).

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

Por defecto, `timeoutMs` es `3_000`, `cacheMs` es `1_000`, `path` es `'/health'` y `readyPath` es `'/ready'`. `HEALTH_OPTIONS` es el token de las opciones.

## viga/crypto

[Ver la guía](../../optional/crypto/).

```ts
function hashPassword(password: string): Promise<string>;
function verifyPassword(password: string, stored: string): Promise<boolean>;
function needsRehash(stored: string): boolean;
function randomToken(bytes?: number): string;
function hashToken(token: string): string;
function safeEqual(a: string, b: string): boolean;
```

`randomToken` genera 32 bytes por defecto.

| Decorador | Qué hace |
| --- | --- |
| `@Signed()` | Exige una URL firmada y válida. |

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

`CRYPTO_OPTIONS` es el token de las opciones.

## viga/events

[Ver la guía](../../optional/events/).

| Decorador | Qué hace |
| --- | --- |
| `@OnEvent(Event)` | Ejecuta el método cuando se emite ese evento. |

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

`drainTimeoutMs` es `10_000` por defecto. `EVENTS_OPTIONS` es el token de las opciones.

## viga/workers

[Ver la guía](../../optional/workers/).

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

Por defecto, `key` es `process.argv[2]`, `orphanTimeoutMs` es `30_000`, `maxWorkers` es `8` y `stopTimeoutMs` es `30_000`. `WORKER_KEY` es el token con la clave del worker actual, y `WORKERS_OPTIONS` el de las opciones.

## viga/upload

[Ver la guía](../../optional/upload/).

| Decorador | Qué hace |
| --- | --- |
| `@Upload(options)` | Recibe archivos en una ruta y añade `file` y `files` al contexto. |

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

Los valores por defecto están en [Límites](../../optional/upload/#límites).
