---
title: 'Referência: viga'
description: Tudo o que o pacote viga exporta, com assinaturas e valores padrão, de createApp e dos decoradores até as exceções e o rate limit.
sidebar:
  order: 1
---

Tudo o que você pode importar de `viga`. Cada seção leva à página que explica o assunto com exemplos. Os módulos opcionais estão em [sua própria referência](../modules/).

## A aplicação

```ts
function createApp(options: AppOptions): App;
```

Cria a aplicação sem iniciá-la. [Ver o ciclo de vida](../../core/app-lifecycle/).

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

| Método | O que faz |
| --- | --- |
| `use` | Adiciona [middlewares do Express](../../core/request-lifecycle/#middlewares-do-express). |
| `useAuthGuard` | Define o [guard de autenticação](../../core/guards/#o-guard-de-autenticação). |
| `useGlobalInterceptors` | Adiciona [interceptors](../../core/interceptors/#onde-se-aplicam) a todas as rotas. |
| `init` | [Inicia sem abrir a porta](../../core/app-lifecycle/#iniciar-sem-servidor). |
| `get` | Devolve um provider visível a partir do módulo raiz. Só funciona depois de `init()` ou `listen()`. |
| `listen` | Inicia o servidor. A porta padrão é `3000`. |
| `close` | [Para o servidor](../../core/app-lifecycle/#parar) e fecha os providers. |
| `enableShutdownHooks` | Chama `close()` ao receber um sinal. Por padrão, `SIGTERM` e `SIGINT`. |

### `AppOptions`

| Opção | Tipo | Padrão | O que faz |
| --- | --- | --- | --- |
| `rootModule` | `AnyConstructor` | Obrigatória | O módulo raiz. |
| `globalPrefix` | `string` | Sem prefixo | Prefixo de todas as rotas. |
| `resolveMessage` | `MessageResolver` | Mensagens em inglês | Traduz os erros, como faz [`viga/i18n`](../../optional/i18n/). |
| `logger` | `Logger` | `console` com cores no terminal | [O logger da aplicação](../../core/providers/#use-seu-próprio-logger). |
| `bodyParser` | `boolean` | `true` | Lê os corpos JSON. |
| `bodyLimit` | `number \| string` | `'100kb'` | [Tamanho máximo do corpo](../../security/defaults/#tamanho-do-corpo). |
| `securityHeaders` | `boolean \| SecurityHeaders` | `true` | [Cabeçalhos de segurança](../../security/defaults/#cabeçalhos-de-segurança). |
| `requestId` | `boolean \| RequestIdOptions` | `true` | [Id de cada requisição](../../core/request-lifecycle/#o-id-da-requisição). |
| `trustProxy` | `boolean \| number \| string \| string[]` | Sem confiar em proxies | [IP do cliente](../../security/client-ip/). |
| `timeouts` | `ServerTimeouts` | Veja abaixo | [Tempos de espera](../../security/defaults/#tempos-de-espera). |
| `requireValidation` | `boolean` | `true` | [Exige validar o corpo](../../security/defaults/#validação-obrigatória-do-corpo). |
| `concealRoutes` | `boolean` | `true` com guard de autenticação | [Oculta quais rotas existem](../../core/guards/#rotas-que-não-existem). |
| `csrf` | `boolean \| CsrfOptions` | `true` | [Proteção CSRF](../../security/defaults/#proteção-csrf). |

### `ServerTimeouts`

| Opção | Padrão | O que limita |
| --- | --- | --- |
| `headers` | `10_000` | Quanto se espera para receber os cabeçalhos, em milissegundos. |
| `request` | `30_000` | Quanto se espera para receber a requisição completa. |
| `keepAlive` | `5_000` | Quanto tempo uma conexão inativa continua aberta. |

## Decoradores

| Decorador | Vai em | O que faz |
| --- | --- | --- |
| `@Module(options)` | Classe | Declara um [módulo](../../core/modules/). |
| `@Injectable()` | Classe | Permite que o viga crie a classe. [Ver providers](../../core/providers/). |
| `@Controller(prefix?)` | Classe | Declara um [controller](../../core/controllers/). |
| `@Get(path?)`, `@Post(path?)`, `@Put(path?)`, `@Patch(path?)`, `@Delete(path?)` | Método | Declara uma rota. |
| `@HttpCode(code)` | Método | Muda o código da resposta. |
| `@Public()` | Classe ou método | [Abre uma rota](../../core/guards/#rotas-privadas-por-padrão). |
| `@UseGuards(...guards)` | Classe ou método | Adiciona [guards](../../core/guards/#guards-por-rota). |
| `@UseInterceptors(...refs)` | Classe ou método | Adiciona [interceptors](../../core/interceptors/). |
| `@RateLimit(options)` | Classe ou método | Limita as requisições. [Ver rate limit](../../security/rate-limiting/#por-rota). |

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

[Ver as opções de `@Module`](../../core/modules/#as-opções-de-module).

## Injeção de dependências

```ts
function inject<T>(token: Token<T>): T;
```

Pede um provider. Só funciona enquanto o viga constrói uma classe: nos campos ou no construtor dela. [Ver providers](../../core/providers/).

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

`Provider` aceita [quatro formas](../../core/providers/#as-quatro-formas-de-declarar-um-provider): a classe, `useClass`, `useValue` ou `useFactory`.

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

`Injector` é o contêiner que o viga usa internamente. Quase nunca é preciso criá-lo à mão.

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

## Guards e interceptors

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

[Ver interceptors](../../core/interceptors/).

## A requisição e seu contexto

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

`StandardSchemaV1` é o tipo do [Standard Schema](https://standardschema.dev), reexportado pelo viga.

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

[Ver o contexto da requisição](../../core/request-lifecycle/#o-contexto-da-requisição).

`REQUEST_ID` é uma chave de contexto com o id da requisição atual. `RequestIdOptions` o configura:

| Opção | Padrão | O que faz |
| --- | --- | --- |
| `header` | `'X-Request-Id'` | O cabeçalho da resposta. |
| `trustIncoming` | `false` | Se aceita o id que o cliente envia. |
| `generate` | `randomUUID` | Gera cada id. |

`CLIENT_IP` é um token com a função que obtém o IP do cliente. [Ver IP do cliente](../../security/client-ip/).

```ts
type ClientIpResolver = (req: IncomingMessage) => string | undefined;
```

## Hooks do ciclo de vida

Os providers os implementam para agir em cada fase. [Ver a ordem](../../core/app-lifecycle/#os-hooks-dos-providers).

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

## Exceções

| Exceção | Status | `code` padrão |
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

Todas recebem `(code?, params?)`, exceto `BadRequestException`, que recebe `(code?, details?, params?)`. [Ver exceções](../../core/exceptions/).

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

`rateLimit` é para toda a aplicação, e `@RateLimit` para uma rota. `maxKeys` é `10_000` por padrão, e `ipKey` agrupa os endereços IPv6 em redes `/56`. [Ver rate limit](../../security/rate-limiting/).

## Segurança

`DEFAULT_SECURITY_HEADERS` contém os [cabeçalhos que o viga envia](../../security/defaults/#cabeçalhos-de-segurança). `SecurityHeaders` os muda: um texto substitui o valor e `false` remove o cabeçalho.

```ts
type SecurityHeaders = Record<string, string | false>;

interface CsrfOptions {
  trustedOrigins?: readonly string[];
}
```

[Ver proteção CSRF](../../security/defaults/#proteção-csrf).

## Logger

```ts
interface Logger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
  debug(message: string, ...meta: unknown[]): void;
}
```

`LOGGER` é o token para pedir o logger com `inject()`, e `silentLogger` é um que não escreve nada. [Ver o logger](../../core/providers/#use-seu-próprio-logger).

## Mensagens para desenvolvedores

`DIAGNOSTICS` contém as mensagens dos erros de configuração do viga, e `setDiagnostics` as traduz. [Ver como](../../optional/i18n/#mensagens-para-desenvolvedores).

```ts
function setDiagnostics(dictionary: DiagnosticDictionary): void;
type DiagnosticKey = keyof typeof DIAGNOSTICS;
type DiagnosticDictionary = Partial<Record<DiagnosticKey, string>>;
```
