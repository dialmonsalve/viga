---
title: 'Referência: módulos opcionais'
description: Tudo o que cada módulo opcional do viga exporta, com assinaturas e valores padrão, de viga/config a viga/workers.
sidebar:
  order: 2
---

Tudo o que você pode importar de cada módulo opcional. O que você importa de `viga` está em [sua própria referência](../core/).

## viga/config

[Ver o guia](../../optional/config/).

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

`env` é `process.env` por padrão. `CONFIG` é o token com a configuração validada, do tipo `Config`, que vem do esquema que você declara na interface `Register`.

## viga/validation

[Ver o guia](../../optional/validation/).

| Decorador | O que faz |
| --- | --- |
| `@Validate(schemas)` | Valida `body`, `query` e `params` de uma rota. |

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

`VALIDATION_OPTIONS` é o token das opções, e `ValidationErrors` é o tipo de `details` em um erro de validação, com uma lista de `ValidationIssue` por parte. `StandardSchemaV1` é reexportado.

## viga/testing

[Ver o guia](../../optional/testing/).

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

[Ver o guia](../../optional/pagination/).

| Decorador | O que faz |
| --- | --- |
| `@Paginate(options?)` | Lê `?page` e `?limit` e adiciona `page` ao contexto. |

| Opção | Padrão |
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

[Ver o guia](../../optional/i18n/).

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

`diagnosticsEs` contém as [mensagens para desenvolvedores](../../optional/i18n/#mensagens-para-desenvolvedores) em espanhol.

## viga/drizzle

[Ver o guia](../../optional/drizzle/).

| Decorador | O que faz |
| --- | --- |
| `@Transactional(config?)` | Executa um método dentro de uma transação. |

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

`DatabaseService` também expõe `pool`, o `Pool` do `pg`. `DRIZZLE_OPTIONS` é o token das opções. `Register` é a interface onde você declara seu esquema, e `RegisteredSchema` é o tipo resultante. `Database`, `Executor`, `Transaction` e `TransactionConfig` são tipos do Drizzle com esse esquema.

## viga/websocket

[Ver o guia](../../optional/websocket/).

| Decorador | Vai em | O que faz |
| --- | --- | --- |
| `@Gateway(path)` | Classe | Declara um gateway. |
| `@OnMessage(event, schema?)` | Método | Atende um evento. |
| `@RateLimit(options)` | Classe ou método | Limita as mensagens. É diferente do `RateLimit` de `viga`. |

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

Os valores padrão estão em [Limites padrão](../../optional/websocket/#limites-por-padrão). `WEBSOCKET_OPTIONS` é o token das opções.

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

Para escrever [outro adaptador](../../optional/websocket/#outros-adaptadores):

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

`WsVerdict` é a decisão sobre um handshake: `accept`, `reject` com um `status`, ou `ignore`.

## viga/health

[Ver o guia](../../optional/health/).

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

Por padrão, `timeoutMs` é `3_000`, `cacheMs` é `1_000`, `path` é `'/health'` e `readyPath` é `'/ready'`. `HEALTH_OPTIONS` é o token das opções.

## viga/crypto

[Ver o guia](../../optional/crypto/).

```ts
function hashPassword(password: string): Promise<string>;
function verifyPassword(password: string, stored: string): Promise<boolean>;
function needsRehash(stored: string): boolean;
function randomToken(bytes?: number): string;
function hashToken(token: string): string;
function safeEqual(a: string, b: string): boolean;
```

`randomToken` gera 32 bytes por padrão.

| Decorador | O que faz |
| --- | --- |
| `@Signed()` | Exige uma URL assinada e válida. |

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

`CRYPTO_OPTIONS` é o token das opções.

## viga/events

[Ver o guia](../../optional/events/).

| Decorador | O que faz |
| --- | --- |
| `@OnEvent(Event)` | Executa o método quando esse evento é emitido. |

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

`drainTimeoutMs` é `10_000` por padrão. `EVENTS_OPTIONS` é o token das opções.

## viga/workers

[Ver o guia](../../optional/workers/).

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

Por padrão, `key` é `process.argv[2]`, `orphanTimeoutMs` é `30_000`, `maxWorkers` é `8` e `stopTimeoutMs` é `30_000`. `WORKER_KEY` é o token com a chave do worker atual, e `WORKERS_OPTIONS` o das opções.

## viga/upload

[Ver o guia](../../optional/upload/).

| Decorador | O que faz |
| --- | --- |
| `@Upload(options)` | Recebe arquivos em uma rota e adiciona `file` e `files` ao contexto. |

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

Os valores padrão estão em [Limites](../../optional/upload/#limites).

## viga/openapi

[Ver o guia](../../optional/openapi/).

| Decorador | O que faz |
| --- | --- |
| `@Docs(options)` | Adiciona textos e respostas a uma rota, ou agrupa as de uma classe. |

```ts
class OpenApiModule {
  static forRoot(options: OpenApiOptions | (() => OpenApiOptions), { path, public: isPublic }?: OpenApiRoutes): {
      new (): {};
  };
}

interface OpenApiRoutes {
  path?: string;
  public?: boolean;
}

interface OpenApiOptions {
  title: string;
  version: string;
  description?: string;
  securitySchemes?: Readonly<Record<string, OpenApiSecurityScheme>>;
}

type OpenApiSecurityScheme = {
  type: 'http';
  scheme: string;
  bearerFormat?: string;
  description?: string;
} | {
  type: 'apiKey';
  name: string;
  in: 'query' | 'header' | 'cookie';
  description?: string;
} | {
  type: 'oauth2';
  flows: Record<string, unknown>;
  description?: string;
} | {
  type: 'openIdConnect';
  openIdConnectUrl: string;
  description?: string;
};

interface DocsOptions {
  summary?: string;
  description?: string;
  tags?: readonly string[];
  responses?: Readonly<Record<number, DocsResponse>>;
  deprecated?: boolean;
  hidden?: boolean;
}

class OpenApiService implements OnServerListen {
  document(): OpenApiDocument;
}

interface OpenApiDocument {
  openapi: '3.1.0';
  info: {
      title: string;
      version: string;
      description?: string;
  };
  paths: Record<string, Record<string, unknown>>;
  components: {
      schemas: Record<string, unknown>;
      securitySchemes?: Record<string, OpenApiSecurityScheme>;
  };
}
```

`path` é `'/openapi.json'` por padrão e `public` é `false`. `DocsResponse` é um esquema ou um texto, e `OPENAPI_OPTIONS` é o token das opções.
