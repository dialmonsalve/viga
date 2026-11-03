---
title: 'Referencia: viga'
description: Todo lo que exporta el paquete viga, con sus firmas y valores por defecto, desde createApp y los decoradores hasta las excepciones y el rate limit.
sidebar:
  order: 1
---

Todo lo que puedes importar desde `viga`. Cada sección enlaza a la página que lo explica con ejemplos. Los módulos opcionales están en [su propia referencia](../modules/).

## La app

```ts
function createApp(options: AppOptions): App;
```

Crea la app sin arrancarla. [Ver el ciclo de vida](../../core/app-lifecycle/).

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

| Método | Qué hace |
| --- | --- |
| `use` | Añade [middlewares de Express](../../core/request-lifecycle/#middlewares-de-express). |
| `useAuthGuard` | Define el [guard de autenticación](../../core/guards/#el-guard-de-autenticación). |
| `useGlobalInterceptors` | Añade [interceptores](../../core/interceptors/#dónde-se-aplican) a todas las rutas. |
| `init` | [Arranca sin abrir el puerto](../../core/app-lifecycle/#arrancar-sin-servidor). |
| `get` | Devuelve un provider visible desde el módulo raíz. Solo funciona después de `init()` o `listen()`. |
| `listen` | Arranca el servidor. El puerto por defecto es `3000`. |
| `close` | [Detiene el servidor](../../core/app-lifecycle/#detenerse) y cierra los providers. |
| `enableShutdownHooks` | Llama a `close()` al recibir una señal. Por defecto, `SIGTERM` y `SIGINT`. |

### `AppOptions`

| Opción | Tipo | Por defecto | Qué hace |
| --- | --- | --- | --- |
| `rootModule` | `AnyConstructor` | Obligatoria | El módulo raíz. |
| `globalPrefix` | `string` | Sin prefijo | Prefijo de todas las rutas. |
| `resolveMessage` | `MessageResolver` | Mensajes en inglés | Traduce los errores, como hace [`viga/i18n`](../../optional/i18n/). |
| `logger` | `Logger` | `console` | [El logger de la app](../../core/providers/#usa-tu-propio-logger). |
| `bodyParser` | `boolean` | `true` | Lee los cuerpos JSON. |
| `bodyLimit` | `number \| string` | `'100kb'` | [Tamaño máximo del cuerpo](../../security/defaults/#tamaño-del-cuerpo). |
| `securityHeaders` | `boolean \| SecurityHeaders` | `true` | [Cabeceras de seguridad](../../security/defaults/#cabeceras-de-seguridad). |
| `requestId` | `boolean \| RequestIdOptions` | `true` | [Id de cada petición](../../core/request-lifecycle/#el-id-de-la-petición). |
| `trustProxy` | `boolean \| number \| string \| string[]` | Sin confiar en proxies | [IP del cliente](../../security/client-ip/). |
| `timeouts` | `ServerTimeouts` | Ver abajo | [Tiempos de espera](../../security/defaults/#tiempos-de-espera). |
| `requireValidation` | `boolean` | `true` | [Exige validar el cuerpo](../../security/defaults/#validación-obligatoria-del-cuerpo). |
| `concealRoutes` | `boolean` | `true` con guard de autenticación | [Oculta qué rutas existen](../../core/guards/#rutas-que-no-existen). |
| `csrf` | `boolean \| CsrfOptions` | `true` | [Protección CSRF](../../security/defaults/#protección-csrf). |

### `ServerTimeouts`

| Opción | Por defecto | Qué limita |
| --- | --- | --- |
| `headers` | `10_000` | Lo que se espera a recibir las cabeceras, en milisegundos. |
| `request` | `30_000` | Lo que se espera a recibir la petición completa. |
| `keepAlive` | `5_000` | Lo que una conexión inactiva sigue abierta. |

## Decoradores

| Decorador | Se pone en | Qué hace |
| --- | --- | --- |
| `@Module(options)` | Clase | Declara un [módulo](../../core/modules/). |
| `@Injectable()` | Clase | Permite que viga cree la clase. [Ver providers](../../core/providers/). |
| `@Controller(prefix?)` | Clase | Declara un [controlador](../../core/controllers/). |
| `@Get(path?)`, `@Post(path?)`, `@Put(path?)`, `@Patch(path?)`, `@Delete(path?)` | Método | Declara una ruta. |
| `@HttpCode(code)` | Método | Cambia el código de la respuesta. |
| `@Public()` | Clase o método | [Abre una ruta](../../core/guards/#rutas-privadas-por-defecto). |
| `@UseGuards(...guards)` | Clase o método | Añade [guards](../../core/guards/#guards-por-ruta). |
| `@UseInterceptors(...refs)` | Clase o método | Añade [interceptores](../../core/interceptors/). |
| `@RateLimit(options)` | Clase o método | Limita las peticiones. [Ver rate limit](../../security/rate-limiting/#por-ruta). |

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

[Ver las opciones de `@Module`](../../core/modules/#las-opciones-de-module).

## Inyección de dependencias

```ts
function inject<T>(token: Token<T>): T;
```

Pide un provider. Solo funciona mientras viga construye una clase: en sus campos o en su constructor. [Ver providers](../../core/providers/).

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

`Provider` acepta [cuatro formas](../../core/providers/#las-cuatro-formas-de-declarar-un-provider): la clase, `useClass`, `useValue` o `useFactory`.

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

`Injector` es el contenedor que usa viga internamente. Casi nunca hace falta crearlo a mano.

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

## Guards e interceptores

```ts
interface CanActivate<C = HttpContext> {
  canActivate(ctx: C): boolean | Promise<boolean>;
}
type GuardFn<C = HttpContext> = (ctx: C) => boolean | Promise<boolean>;
type Guard<C = HttpContext> = AnyConstructor<CanActivate<C>> | GuardFn<C>;
```

[Ver guards](../../core/guards/).

```ts
type CallHandler = () => Promise<unknown>;
interface Interceptor<C = HttpContext> {
  intercept(ctx: C, next: CallHandler): unknown;
}
type InterceptorFn<C = HttpContext> = (ctx: C, next: CallHandler) => unknown;
type InterceptorRef<C = HttpContext> = AnyConstructor<Interceptor<C>> | InterceptorFn<C>;
```

[Ver interceptores](../../core/interceptors/).

## La petición y su contexto

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

`StandardSchemaV1` es el tipo de [Standard Schema](https://standardschema.dev), reexportado por viga.

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

[Ver el contexto de la petición](../../core/request-lifecycle/#el-contexto-de-la-petición).

`REQUEST_ID` es una clave de contexto con el id de la petición actual. `RequestIdOptions` lo configura:

| Opción | Por defecto | Qué hace |
| --- | --- | --- |
| `header` | `'X-Request-Id'` | La cabecera de la respuesta. |
| `trustIncoming` | `false` | Si acepta el id que envía el cliente. |
| `generate` | `randomUUID` | Genera cada id. |

`CLIENT_IP` es un token con la función que obtiene la IP del cliente. [Ver IP del cliente](../../security/client-ip/).

```ts
type ClientIpResolver = (req: IncomingMessage) => string | undefined;
```

## Hooks del ciclo de vida

Los providers los implementan para actuar en cada fase. [Ver el orden](../../core/app-lifecycle/#los-hooks-de-los-providers).

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

## Excepciones

| Excepción | Estado | `code` por defecto |
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

Todas reciben `(code?, params?)`, salvo `BadRequestException`, que recibe `(code?, details?, params?)`. [Ver excepciones](../../core/exceptions/).

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

## Rate limit

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

`rateLimit` es para toda la app, y `@RateLimit` para una ruta. `maxKeys` es `10_000` por defecto, y `ipKey` agrupa las direcciones IPv6 en redes `/56`. [Ver rate limit](../../security/rate-limiting/).

## Seguridad

`DEFAULT_SECURITY_HEADERS` contiene las [cabeceras que envía viga](../../security/defaults/#cabeceras-de-seguridad). `SecurityHeaders` las cambia: un texto reemplaza el valor y `false` quita la cabecera.

```ts
type SecurityHeaders = Record<string, string | false>;

interface CsrfOptions {
  trustedOrigins?: readonly string[];
}
```

[Ver protección CSRF](../../security/defaults/#protección-csrf).

## Logger

```ts
interface Logger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
  debug(message: string, ...meta: unknown[]): void;
}
```

`LOGGER` es el token para pedir el logger con `inject()`, y `silentLogger` es uno que no escribe nada. [Ver el logger](../../core/providers/#usa-tu-propio-logger).

## Mensajes para desarrolladores

`DIAGNOSTICS` contiene los mensajes de los errores de configuración de viga, y `setDiagnostics` los traduce. [Ver cómo](../../optional/i18n/#mensajes-para-desarrolladores).

```ts
function setDiagnostics(dictionary: DiagnosticDictionary): void;
type DiagnosticKey = keyof typeof DIAGNOSTICS;
type DiagnosticDictionary = Partial<Record<DiagnosticKey, string>>;
```
