---
title: 'Reference: viga'
description: Everything the viga package exports, with signatures and default values, from createApp and the decorators to exceptions and rate limiting.
sidebar:
  order: 1
---

Everything you can import from `viga`. Each section links to the page that explains it with examples. Optional modules are in [their own reference](../modules/).

## The app

```ts
function createApp(options: AppOptions): App;
```

Creates the app without starting it. [See the lifecycle](../../core/app-lifecycle/).

```ts
class App {
  readonly express: Application;
  readonly logger: Logger;
  setGlobalPrefix(prefix: string): this;
  use(...middlewares: RequestHandler[]): this;
  useAuthGuard(guard: Guard): this;
  useGlobalInterceptors(...interceptors: InterceptorRef[]): this;
  init(): Promise<this>;
  get<T>(token: Token<T>): T;
  listen(port?: number, host?: string): Promise<Server>;
  close(): Promise<void>;
  enableShutdownHooks(signals?: readonly NodeJS.Signals[]): this;
}
```

| Method | What it does |
| --- | --- |
| `use` | Adds [Express middlewares](../../core/request-lifecycle/#express-middlewares). |
| `useAuthGuard` | Sets the [authentication guard](../../core/guards/#the-authentication-guard). |
| `useGlobalInterceptors` | Adds [interceptors](../../core/interceptors/#where-they-apply) to every route. |
| `init` | [Starts without opening the port](../../core/app-lifecycle/#starting-without-a-server). |
| `get` | Returns a provider visible from the root module. Only works after `init()` or `listen()`. |
| `listen` | Starts the server. The default port is `3000`. |
| `close` | [Stops the server](../../core/app-lifecycle/#stopping) and closes the providers. |
| `enableShutdownHooks` | Calls `close()` when a signal arrives. By default, `SIGTERM` and `SIGINT`. |

### `AppOptions`

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `rootModule` | `AnyConstructor` | Required | The root module. |
| `globalPrefix` | `string` | No prefix | Prefix for every route. |
| `resolveMessage` | `MessageResolver` | English messages | Translates errors, as [`viga/i18n`](../../optional/i18n/) does. |
| `logger` | `Logger` | `console` | [The app's logger](../../core/providers/#use-your-own-logger). |
| `bodyParser` | `boolean` | `true` | Reads JSON bodies. |
| `bodyLimit` | `number \| string` | `'100kb'` | [Maximum body size](../../security/defaults/#body-size). |
| `securityHeaders` | `boolean \| SecurityHeaders` | `true` | [Security headers](../../security/defaults/#security-headers). |
| `requestId` | `boolean \| RequestIdOptions` | `true` | [Each request's id](../../core/request-lifecycle/#the-request-id). |
| `trustProxy` | `boolean \| number \| string \| string[]` | Trusts no proxies | [Client IP](../../security/client-ip/). |
| `timeouts` | `ServerTimeouts` | See below | [Timeouts](../../security/defaults/#timeouts). |
| `requireValidation` | `boolean` | `true` | [Requires validating the body](../../security/defaults/#mandatory-body-validation). |
| `concealRoutes` | `boolean` | `true` with an authentication guard | [Hides which routes exist](../../core/guards/#routes-that-dont-exist). |
| `csrf` | `boolean \| CsrfOptions` | `true` | [CSRF protection](../../security/defaults/#csrf-protection). |

### `ServerTimeouts`

| Option | Default | What it limits |
| --- | --- | --- |
| `headers` | `10_000` | How long to wait for the headers, in milliseconds. |
| `request` | `30_000` | How long to wait for the whole request. |
| `keepAlive` | `5_000` | How long an idle connection stays open. |

## Decorators

| Decorator | Goes on | What it does |
| --- | --- | --- |
| `@Module(options)` | Class | Declares a [module](../../core/modules/). |
| `@Injectable()` | Class | Lets viga create the class. [See providers](../../core/providers/). |
| `@Controller(prefix?)` | Class | Declares a [controller](../../core/controllers/). |
| `@Get(path?)`, `@Post(path?)`, `@Put(path?)`, `@Patch(path?)`, `@Delete(path?)` | Method | Declares a route. |
| `@HttpCode(code)` | Method | Changes the response status code. |
| `@Public()` | Class or method | [Opens a route](../../core/guards/#private-routes-by-default). |
| `@UseGuards(...guards)` | Class or method | Adds [guards](../../core/guards/#per-route-guards). |
| `@UseInterceptors(...refs)` | Class or method | Adds [interceptors](../../core/interceptors/). |
| `@RateLimit(options)` | Class or method | Limits requests. [See rate limiting](../../security/rate-limiting/#per-route). |

### `ModuleOptions`

```ts
interface ModuleOptions {
  imports?: AnyConstructor[];
  controllers?: AnyConstructor[];
  providers?: Provider[];
  exports?: Token[];
  global?: boolean;
}
```

[See the `@Module` options](../../core/modules/#the-module-options).

## Dependency injection

```ts
function inject<T>(token: Token<T>): T;
```

Asks for a provider. It only works while viga is building a class: in its fields or constructor. [See providers](../../core/providers/).

```ts
class InjectionToken<T> {
  readonly description: string;
  constructor(description: string);
}
```

```ts
type Token<T = unknown> = AnyConstructor<T> | InjectionToken<T>;
type AnyConstructor<T = unknown> = new (...args: any[]) => T;
```

`Provider` accepts [four forms](../../core/providers/#the-four-ways-to-declare-a-provider): the class, `useClass`, `useValue` or `useFactory`.

```ts
type Provider<T = unknown> = AnyConstructor<T> | {
    provide: Token<T>;
    useClass: AnyConstructor<T>;
} | {
    provide: Token<T>;
    useValue: T;
} | {
    provide: Token<T>;
    useFactory: () => T;
};
```

`Injector` is the container viga uses internally. You almost never need to create one by hand.

```ts
class Injector {
  readonly name: string;
  constructor(providers?: Provider[], options?: InjectorOptions);
  get<T>(token: Token<T>): T;
  find<T>(token: Token<T>): T | undefined;
  instantiate<T>(Class: AnyConstructor<T>): T;
  getOrInstantiate<T>(Class: AnyConstructor<T>): T;
  resolveAll(): unknown[];
}

interface InjectorOptions {
  name?: string;
  imports?: Injector[];
  exports?: Token[];
  reexports?: Injector[];
  globals?: readonly Injector[];
}
```

## Guards and interceptors

```ts
interface CanActivate<C = HttpContext> {
  canActivate(ctx: C): boolean | Promise<boolean>;
}
type GuardFn<C = HttpContext> = (ctx: C) => boolean | Promise<boolean>;
type Guard<C = HttpContext> = AnyConstructor<CanActivate<C>> | GuardFn<C>;
```

[See guards](../../core/guards/).

```ts
type CallHandler = () => Promise<unknown>;
interface Interceptor<C = HttpContext> {
  intercept(ctx: C, next: CallHandler): unknown;
}
type InterceptorFn<C = HttpContext> = (ctx: C, next: CallHandler) => unknown;
type InterceptorRef<C = HttpContext> = AnyConstructor<Interceptor<C>> | InterceptorFn<C>;
```

[See interceptors](../../core/interceptors/).

## The request and its context

```ts
interface HttpContext<S extends RequestSchemas = RequestSchemas> {
  req: Request;
  res: Response;
  body: Parsed<S, 'body', unknown>;
  query: Parsed<S, 'query', Request['query']>;
  params: Parsed<S, 'params', Request['params']>;
}

interface RequestSchemas {
  body?: StandardSchemaV1;
  query?: StandardSchemaV1;
  params?: StandardSchemaV1;
}
```

`StandardSchemaV1` is the [Standard Schema](https://standardschema.dev) type, re-exported by viga.

```ts
function createContextKey<T>(description: string, { detached }?: ContextKeyOptions): ContextKey<T>;
function runInNewContext<R>(fn: () => R): R;

interface ContextKey<T> {
  readonly description: string;
  get(): T;
  find(): T | undefined;
  run<R>(value: T, fn: () => R): R;
  set(value: T): void;
}

interface ContextKeyOptions {
  detached?: boolean;
}
```

[See the request context](../../core/request-lifecycle/#the-request-context).

`REQUEST_ID` is a context key with the current request's id. `RequestIdOptions` configures it:

| Option | Default | What it does |
| --- | --- | --- |
| `header` | `'X-Request-Id'` | The response header. |
| `trustIncoming` | `false` | Whether it accepts the id the client sends. |
| `generate` | `randomUUID` | Generates each id. |

`CLIENT_IP` is a token with the function that gets the client's IP. [See client IP](../../security/client-ip/).

```ts
type ClientIpResolver = (req: IncomingMessage) => string | undefined;
```

## Lifecycle hooks

Providers implement them to act at each phase. [See the order](../../core/app-lifecycle/#provider-hooks).

```ts
interface OnModuleInit {
  onModuleInit(): unknown;
}
interface OnServerListen {
  onServerListen(server: Server): unknown;
}
interface OnServerClose {
  onServerClose(): unknown;
}
interface OnDrain {
  onDrain(): unknown;
}
interface OnModuleDestroy {
  onModuleDestroy(): unknown;
}
```

## Exceptions

| Exception | Status | Default `code` |
| --- | --- | --- |
| `BadRequestException` | 400 | `errors.badRequest` |
| `UnauthorizedException` | 401 | `errors.unauthorized` |
| `ForbiddenException` | 403 | `errors.forbidden` |
| `NotFoundException` | 404 | `errors.notFound` |
| `ConflictException` | 409 | `errors.conflict` |
| `PayloadTooLargeException` | 413 | `errors.payloadTooLarge` |
| `UnsupportedMediaTypeException` | 415 | `errors.unsupportedMediaType` |
| `TooManyRequestsException` | 429 | `errors.tooManyRequests` |
| `InternalServerErrorException` | 500 | `errors.internal` |
| `ServiceUnavailableException` | 503 | `errors.serviceUnavailable` |

All receive `(code?, params?)`, except `BadRequestException`, which receives `(code?, details?, params?)`. [See exceptions](../../core/exceptions/).

```ts
class HttpException extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly error: string;
  readonly details?: unknown;
  readonly params?: MessageParams | undefined;
  constructor(statusCode: number, code: string, error?: string, details?: unknown, params?: MessageParams | undefined);
}

interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  error: string;
  details?: unknown;
  requestId?: string;
  timestamp: string;
}

type MessageParams = Record<string, string | number>;
type MessageResolver = (code: string, params: MessageParams | undefined, req: Request) => string | undefined;
```

## Rate limiting

```ts
function rateLimit(options: RateLimitOptions): RequestHandler;
function ipKey(address: string, ipv6Subnet?: number): string;

interface RateLimitOptions {
  max: number;
  windowMs: number;
  key?: (req: Request) => string;
  store?: RateLimitStore;
}

interface RateLimitStore {
  hit(key: string, windowMs: number): RateLimitHit | Promise<RateLimitHit>;
}

interface RateLimitHit {
  count: number;
  resetAt: number;
}

class MemoryRateLimitStore implements RateLimitStore {
  constructor({ maxKeys }?: MemoryRateLimitStoreOptions);
  get size(): number;
  hit(rawKey: string, windowMs: number): RateLimitHit;
}

interface MemoryRateLimitStoreOptions {
  maxKeys?: number;
}
```

`rateLimit` is for the whole app, and `@RateLimit` for one route. `maxKeys` is `10_000` by default, and `ipKey` groups IPv6 addresses into `/56` networks. [See rate limiting](../../security/rate-limiting/).

## Security

`DEFAULT_SECURITY_HEADERS` contains the [headers viga sends](../../security/defaults/#security-headers). `SecurityHeaders` changes them: a string replaces the value and `false` removes the header.

```ts
type SecurityHeaders = Record<string, string | false>;

interface CsrfOptions {
  trustedOrigins?: readonly string[];
}
```

[See CSRF protection](../../security/defaults/#csrf-protection).

## Logger

```ts
interface Logger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
  debug(message: string, ...meta: unknown[]): void;
}
```

`LOGGER` is the token to ask for the logger with `inject()`, and `silentLogger` is one that writes nothing. [See the logger](../../core/providers/#use-your-own-logger).

## Developer messages

`DIAGNOSTICS` contains the messages of viga's configuration errors, and `setDiagnostics` translates them. [See how](../../optional/i18n/#developer-messages).

```ts
function setDiagnostics(dictionary: DiagnosticDictionary): void;
type DiagnosticKey = keyof typeof DIAGNOSTICS;
type DiagnosticDictionary = Partial<Record<DiagnosticKey, string>>;
```
