# viga

**English** · [Español](README.es.md)

HTTP framework for Node.js on top of Express 5: modules, dependency injection, guards and interceptors with **standard JavaScript decorators (TC39)**. No `reflect-metadata`, no `experimentalDecorators` and no `emitDecoratorMetadata`.

The core only covers what every server needs. Everything else lives in optional subpaths: if you don't import them, nothing extra gets installed.

| Import | What it provides | Requires |
|---|---|---|
| `viga` | Modules, DI, controllers, guards, interceptors, `@Public`, HTTP exceptions, lifecycle, logger | `express` |
| `viga/validation` | `@Validate` and `ValidationModule` with any [Standard Schema](https://standardschema.dev) library | Nothing (you pick Zod, Valibot, ArkType…) |
| `viga/i18n` | Message catalogs, `Accept-Language` negotiation, framework messages in en/es | Nothing |
| `viga/drizzle` | `DrizzleModule` and `DatabaseService` with pool shutdown | `drizzle-orm`, `pg` |
| `viga/config` | `ConfigModule` that validates and types environment variables at startup | Nothing |
| `viga/pagination` | `@Paginate` with typed results, relative links and limits | Nothing |
| `viga/websocket` | Gateways, rooms and a public adapter interface, with restrictive defaults | `ws` |

## Acknowledgements

viga is inspired by [NestJS](https://nestjs.com). Modules, dependency injection, decorator-based controllers, guards and interceptors come from the ideas Kamil Myśliwiec and the Nest community have spent years refining. Thank you for showing that Node backends can have structure.

viga shares no code with Nest. It takes those ideas somewhere else: standard JavaScript decorators (TC39) instead of `experimentalDecorators` and `reflect-metadata`, promises instead of RxJS, and a small core with everything else optional.

It also builds on the work of [Express](https://expressjs.com), [Standard Schema](https://standardschema.dev) and [Drizzle ORM](https://orm.drizzle.team).

## Requirements

- Node.js 24.13 or later
- Express 5
- TypeScript with standard decorators (no `experimentalDecorators`) and `"lib": ["ES2024", "ESNext.Decorators"]`
- A compiler that transforms decorators, such as `tsc` or `tsx`. Node runs TypeScript by stripping types, but it doesn't support decorators yet: `node main.ts` fails at the first `@`.

## Installation

```bash
pnpm add viga express
pnpm add -D @types/express
```

Only if you use `viga/drizzle`:

```bash
pnpm add drizzle-orm pg
pnpm add -D @types/pg
```

Only if you use `viga/websocket` with the default adapter:

```bash
pnpm add ws
```

## Minimal example

```ts
import { Controller, Get, Injectable, Module, Public, createApp, inject } from 'viga';

@Injectable()
class BooksService {
  list() {
    return [{ id: 1, title: 'Dune' }];
  }
}

@Controller('/books')
class BooksController {
  private readonly books = inject(BooksService);

  @Public()
  @Get()
  list() {
    return this.books.list();
  }
}

@Module({ controllers: [BooksController], providers: [BooksService] })
class AppModule {}

const app = createApp({ rootModule: AppModule, globalPrefix: '/api/v1' }).enableShutdownHooks();

await app.listen(3000);
```

Routes are private by default: without `@Public()`, `GET /api/v1/books` would respond 401 until you set a guard with `app.useAuthGuard()` (see [Private routes by default](#private-routes-by-default)).

## Core (`viga`)

### Modules and dependency injection

- Dependencies are requested with `inject()` in class fields. Without reflection, constructor parameter types can't be read.
- Each module sees its own `providers` and whatever the modules it imports export. A module can re-export another one by listing it in `exports`.
- `global: true` makes a module's exports available everywhere without importing it. Use it only for infrastructure (database, configuration). A global module must be in the root module's `imports`; if only another module imports it, the app doesn't start. That way, removing that module never leaves something others relied on unregistered.
- Providers: class, `{ provide, useClass }`, `{ provide, useValue }` and `{ provide, useFactory }`. For values that aren't classes, use `new InjectionToken<T>('NAME')`.
- Circular dependencies and circular imports are detected, with the full chain in the error.

### Lifecycle

Providers can implement `OnModuleInit` and `OnModuleDestroy`:

- `listen(port?, host?)` listens on port 3000 unless told otherwise. `listen(0)` picks a random free port. viga doesn't read `process.env.PORT`; if you need it, pass it explicitly: `app.listen(Number(process.env.PORT ?? 3000))`.
- `init()` (or `listen()`) creates every provider and runs `onModuleInit` in dependency order. If a hook returns a promise, it is awaited.
- `close()` closes the server and runs `onModuleDestroy` in reverse order. If one fails, it still tries to close the rest and throws an `AggregateError`. If startup failed halfway, only the providers that finished `onModuleInit` are closed.
- `OnServerListen` (receives the HTTP server before it starts listening) and `OnServerClose` (runs when the server starts closing, before `onModuleDestroy`) let a provider hook into the server, as `viga/websocket` does.
- `enableShutdownHooks()` calls `close()` on `SIGTERM` or `SIGINT`, then exits with the signal's standard code (143 or 130), or 1 if closing failed. It exits even if something keeps the event loop alive, and also works when Node is PID 1 in a container.

### Private routes by default

- Every route must pass the guard set with `app.useAuthGuard()`. If there is none, it responds 401: nothing is left open by accident.
- `@Public()` on a method or on the whole controller opens the route.
- `@Public` isn't inherited. A subclass of a public controller or gateway is private until it repeats `@Public()`, and an overridden method is private until the new one has `@Public()`. Routes, guards and interceptors are still inherited. That way, extending a public class never opens new routes by accident.
- If there are private routes but no `useAuthGuard()`, the app logs a warning at startup saying how many will respond 401.
- The public routes are listed in the startup log at `debug` level (`Public routes: GET /api/health, POST /api/auth/login`), so you can review what's exposed before a deploy or an audit.

### Request order

Request id → security headers → app middlewares (`app.use`) → CSRF check → authentication (except `@Public`) → body parser → controller guards → method `@UseGuards` (including `@RateLimit`) → global interceptors → controller interceptors → method `@UseInterceptors` → `@Validate` → handler, and back in reverse order.

The body is parsed only after authentication, so an anonymous request to a private route gets 401 without the server reading its body, and an unknown route never parses one. Guards still see it, for example to rate limit by email.

Every guard runs before any interceptor, so an interceptor that answers without calling `next()`, such as a cache, can't skip a method's guard or rate limit. Gateways in `viga/websocket` follow the same rule.

Method decorators follow that order even if you write them in a different one: a user without permission gets 403 before their body is validated. Among several of the same kind, the topmost runs first.

The handler returns the result: the router responds 200, 201 for POST, or 204 if nothing is returned. `@HttpCode` changes it. If the handler already responded through `ctx.res`, the router leaves the response alone.

### Guards and interceptors

```ts
@Injectable()
class TimingInterceptor implements Interceptor {
  async intercept(ctx: HttpContext, next: CallHandler) {
    const start = performance.now();
    const result = await next();
    ctx.res.setHeader('Server-Timing', `app;dur=${performance.now() - start}`);
    return result;
  }
}

app.useGlobalInterceptors(TimingInterceptor);
```

- Guards and interceptors can be classes (with `inject()`) or functions.
- `@UseGuards` goes on the method or the controller. On the controller it protects all its routes, `@Public` ones included: `@Public` only skips authentication. A guard that returns `false` responds 403.
- `@UseInterceptors` goes on the method or the controller. `next()` can only be called once.
- Global ones are resolved with the root module's injector.

### Request context

`createContextKey` stores values that any code can reach during a request without passing them from function to function: the authenticated user, a request id, a transaction.

```ts
import { createContextKey } from 'viga';

export const CURRENT_USER = createContextKey<User>('currentUser');

@Injectable()
class JwtGuard implements CanActivate {
  async canActivate({ req }: HttpContext) {
    const user = await this.verify(req);
    if (!user) return false;
    CURRENT_USER.set(user);
    return true;
  }
}

@Injectable()
class ItemsService {
  create(data: NewItem) {
    const { id } = CURRENT_USER.get();
    return this.items.insert({ ...data, createdById: id, updatedById: id });
  }
}
```

| Method | What it does |
|---|---|
| `get()` | Returns the value, or throws if there is none |
| `find()` | Returns the value or `undefined` |
| `set(value)` | Sets the value for the rest of the request. Works in middlewares, guards and interceptors |
| `run(value, fn)` | Runs `fn` with the value; when it finishes, the previous one is back |

- Each request has its own context, even when the server handles several at once.
- Outside HTTP (scripts, scheduled jobs, tests), `runInNewContext(fn)` opens an empty context where `set()` works.

### Express middlewares

Add them with `app.use()` before `listen()`. They run after the security headers, so they can override them:

```ts
import cors from 'cors';

app.use(cors({ origin: 'https://my-frontend.com', credentials: true }));
```

### Security defaults

These defaults reduce common risks, but they don't make an application secure on their own, and viga can't guarantee that it is. Security also depends on your code, configuration, dependencies and infrastructure, so test and review your app before going to production.

| `createApp` option | Default | What it controls |
|---|---|---|
| `securityHeaders` | `true` | `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` and `Cache-Control: no-store`. An object changes (`{ 'Cache-Control': 'private' }`) or removes (`{ 'X-Frame-Options': false }`) headers; `false` disables them all |
| `bodyLimit` | `'100kb'` | Maximum size of a JSON or urlencoded body. Above it, responds 413. The body is read only on existing routes and after authentication |
| `trustProxy` | not trusted | Same as Express's `trust proxy`. Behind a proxy, set it to the number of proxies in front of the app (for example `1`) or their addresses, so `req.ip` is the client's. Avoid `true`: it takes the first `X-Forwarded-For` value, which the client can forge to bypass rate limits, and viga logs a warning. WebSocket's `connectionsPerKey` uses the same setting |
| `timeouts` | `{ headers: 10_000, request: 30_000, keepAlive: 5_000 }` | Milliseconds to receive the headers, the full request, and between requests on one connection. They limit slow-connection attacks |
| `requestId` | `true` | Generates a UUID per request, sends it in `X-Request-Id`, includes it in errors (`requestId`) and in the 500 log. `{ trustIncoming: true }` reuses the one your gateway sends if it only has letters, digits, `.`, `_` or `-` (128 max); `{ header }` changes the header; `false` disables it |
| `requireValidation` | `true` | A route without a body schema doesn't accept a body: it isn't parsed, and a request that sends one responds 400 `errors.unexpectedBody`. A `POST` without a body, like a logout, needs no decorator, and if you forget `@Validate({ body })` on a create route you see the 400 on the first request, so an unvalidated body never reaches a handler. It applies to every method. After `@Validate`, `ctx.req.body` holds the validated value too, so code that reads it by mistake doesn't get fields the schema dropped. `false` turns it off and every route receives the body as sent |
| `concealRoutes` | on with an auth guard | An unknown route responds 401 to anyone without a session, just like a private route, which makes it harder to find out which routes exist. With a valid session it responds 404; `@Public` routes don't change. It also applies to `viga/websocket` handshakes: an unknown path answers like a private gateway (403 for a forbidden `Origin`, 401 without a session, 404 with one). It's on by default when the app has `useAuthGuard()`, and off without one so a fully public API keeps answering 404. `false` or `true` forces it |
| `csrf` | `true` | Rejects with 403 (`errors.crossSiteRequest`) a `POST` from another site that a browser can send without a CORS preflight: no body, a form (`urlencoded`, `multipart`) or `text/plain`. These are the requests a page on another site can make the browser send with your users' cookies without a preflight. It reads `Sec-Fetch-Site`, or compares `Origin` with the host when that header is missing, and runs before the body is parsed. JSON, `PUT`, `PATCH` and `DELETE` from another origin aren't checked because the browser sends them only after a preflight, which your CORS setup decides. Requests without either header, such as curl or a backend, pass. `{ trustedOrigins: ['https://idp.example'] }` allows forms from those origins, for example an OAuth `form_post` callback; `false` disables it |

- The `X-Powered-By` header is always disabled.
- The 404 for unknown routes doesn't echo the requested path.
- `DEFAULT_SECURITY_HEADERS` exports the default headers.
- `REQUEST_ID.get()` returns the current request id from any service.

### Rate limiting

```ts
import { RateLimit, ipKey, rateLimit } from 'viga';
import { Validate } from 'viga/validation';
import { z } from 'zod';

const Login = z.strictObject({ email: z.email(), password: z.string() });

app.use(rateLimit({ max: 300, windowMs: 60_000 }));

@Public()
@Controller('auth')
class AuthController {
  @Post('login')
  @RateLimit({ max: 5, windowMs: 15 * 60_000, key: (req) => `${ipKey(req.ip ?? '')}:${req.body?.email}` })
  @Validate({ body: Login })
  login({ body }: HttpContext<{ body: typeof Login }>) {}
}
```

- `rateLimit()` is an app-wide middleware; `@RateLimit()` goes on a method or a controller. Each one has its own counter.
- When `max` is exceeded within `windowMs`, it responds 429 with `code: 'errors.tooManyRequests'` and `Retry-After`. Every response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`.
- The default key is `req.ip` normalized with `ipKey()`: an IPv4-mapped address (`::ffff:1.2.3.4`) counts as its IPv4, and an IPv6 address counts as its /56 network, because whoever controls one usually controls the whole block and could otherwise get a fresh counter per address. `ipKey(address, 64)` picks another prefix length. Use `ipKey()` too when you build your own key from the IP. Behind a proxy, set `trustProxy` to the number of proxies, or every client will share the same counter.
- HTTP rate limiting is off by default (WebSocket has a per-connection limit on by default): add `rateLimit()` or `@RateLimit()` yourself. It isn't enabled automatically because, behind a proxy without `trustProxy`, every user would share the proxy's IP and be blocked together.
- The counter lives in memory (`MemoryRateLimitStore`). It keeps at most 10,000 keys (`new MemoryRateLimitStore({ maxKeys })`), and keys longer than 128 characters are stored as a hash, so a flood of unique keys (for example, made-up emails) can't exhaust memory. When it is full it evicts the oldest key seen only once, so a flood of new keys can't erase the counter of a key under attack. If every stored key is live and repeated, a new key is treated as over the limit until one expires: the store fails closed rather than open. Raise `maxKeys` if legitimate traffic can fill it. The counter is per process: with several instances, each one counts on its own and the real limit is multiplied by the number of instances, so implement `RateLimitStore` on Redis or another shared store and pass it as `store`. The window is fixed, so a client can send up to `max` at the end of one window and `max` again at the start of the next; pick `max` with that double burst in mind.

### Security testing checklist

viga only handles some common layers. These depend on your code and are the first thing a gray-box test checks, with real users and roles:

- **Per-resource authorization (IDOR).** Requiring a session isn't enough: check that the resource belongs to the user. Filter by the current user in the repository and respond 404, not 403, when it isn't theirs, so you don't reveal which ids exist:
  ```ts
  findOwned(id: number) {
    const { id: ownerId } = CURRENT_USER.get();
    return this.database.db.query.orders.findFirst({
      where: and(eq(orders.id, id), eq(orders.ownerId, ownerId)),
    });
  }
  ```
- **Mass assignment.** Without `@Validate`, `ctx.body` arrives exactly as the client sent it. Validate every body a route accepts (`requireValidation` rejects bodies on routes without a schema) and use the parsed value. With Zod, `z.strictObject()` rejects extra fields (`"role": "admin"`) instead of ignoring them.
- **Roles.** Put the role guard on the controller with `@UseGuards` so a new route isn't left open by accident.
- **Brute force.** Limit login, sign-up, password recovery and code verification with `@RateLimit`.
- **CORS.** List the allowed origins explicitly; never `origin: '*'` together with `credentials: true`.
- **CSRF.** Keep `csrf` on if you use cookies, and never change state in a `GET`: it isn't checked because a link or an image can trigger it.
- **Error messages.** Don't tell "user doesn't exist" apart from "wrong password": always use `UnauthorizedException()`.

### Errors

```json
{
  "statusCode": 404,
  "code": "books.notFound",
  "message": "Book 7 does not exist",
  "error": "Not Found",
  "timestamp": "2026-10-22T12:00:00.000Z"
}
```

- Exceptions take a code and optional parameters: `throw new NotFoundException('books.notFound', { id })`.
- The `message` is decided by `resolveMessage`, an optional `createApp` hook. If you don't set it or it returns `undefined`, viga uses its default English messages for its own codes (`errors.*`).
- If the code isn't known, it is treated as free text: it goes as-is in `message`, and `code` takes the one for the HTTP status (`errors.notFound`).
- Unexpected errors respond 500 without leaking the internal message. Malformed JSON responds 400.
- If a handler fails after it started writing the response (for example, a stream), the error goes to the logger and the connection is closed, so the client knows the response is incomplete.

```ts
createApp({
  rootModule: AppModule,
  resolveMessage: (code, params, req) => myMessages[code],
});
```

### Developer messages

The framework's own errors and logs (`[DI] BooksModule cannot resolve BooksService…`) are in English by default. They can be adapted with a dictionary, set in `main.ts` before `createApp()`:

```ts
import { setDiagnostics } from 'viga';
import { diagnosticsEs } from 'viga/i18n';

setDiagnostics(diagnosticsEs);
```

- `viga/i18n` ships the full Spanish dictionary.
- A dictionary can be partial: keys it doesn't translate stay in English.
- `DIAGNOSTICS` holds the original English texts, to use as a reference for another dictionary. `{parameters}` are interpolated automatically and the prefix (`[DI]`, `[App]`…) is added for you.
- `setDiagnostics({})` switches back to English.

These messages are for developers. The ones end users see in HTTP responses are configured with `resolveMessage` or `viga/i18n`.

### Logger

`createApp({ logger })` accepts any object with `info`, `warn`, `error` and `debug` (`console` by default). It is available in every module with `inject(LOGGER)`.

## viga/validation

```ts
import { Validate, ValidationModule } from 'viga/validation';
import { z } from 'zod';

const CreateBook = z.object({ title: z.string().min(1) });

@Post()
@Validate({ body: CreateBook })
create({ body }: HttpContext<{ body: typeof CreateBook }>) {
  return this.books.create(body);
}
```

- Validates `body`, `query` and `params` with any schema that implements Standard Schema, async ones included. `HttpContext<{ body: typeof Schema }>` types the parsed data. The handler can also take a context that extends it (for example one that another decorator adds fields to), and TypeScript still rejects a schema that doesn't match.
- On failure it responds 400 with `code: 'errors.validation'` and, in `details`, the errors for each part of the request: `{ path, code?, message }`.
- `ValidationModule.forRoot({ formatIssue })` is optional and customizes the text of each error, for example to translate it. `formatIssue` receives the library's original issue, so it can read any of its fields.

## viga/i18n

```ts
import { I18n } from 'viga/i18n';

const i18n = new I18n({ defaultLocale: 'en', catalogs: { en, es } });

const app = createApp({ rootModule: AppModule, resolveMessage: i18n.resolveMessage })
  .use(i18n.middleware);
```

- `i18n.middleware` picks the language from `Accept-Language` and responds with `Content-Language`. With no header or no match, it uses `defaultLocale`.
- `resolveLocale` reads the language from somewhere else before `Accept-Language`: a header name (`resolveLocale: 'x-lang'`) or a function (`resolveLocale: (req) => req.cookies.lang`). If it doesn't return a language from your catalogs, it falls back to `Accept-Language` and then `defaultLocale`; an unknown value is never used.
- Catalog keys are nested: `'books.notFound'` looks up `{ books: { notFound: '…' } }`.
- `i18n.resolveMessage` translates exception codes. It ships the framework messages in English and Spanish, and your catalogs can replace them.
- `i18n.t(key, params)` and `i18n.locale()` use the language of the current request, in any service.
- `i18n.match(value)` returns the supported language that matches a value (`'pt-BR'` → `'pt'`), or `undefined`; `i18n.negotiate(acceptLanguage)` falls back to `defaultLocale`.
- Combined with validation: `ValidationModule.forRoot({ formatIssue: (issue) => translate(issue, i18n.locale()) })`.

## viga/config

```ts
import { CONFIG, ConfigModule } from 'viga/config';
import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
});

declare module 'viga/config' {
  interface Register {
    schema: typeof Env;
  }
}

@Module({ imports: [ConfigModule.forRoot({ schema: Env }), BooksModule] })
class AppModule {}

@Injectable()
class AuthService {
  private readonly config = inject(CONFIG);
}

const app = createApp({ rootModule: AppModule });
await app.init();
await app.listen(app.get(CONFIG).PORT);
```

- The configuration is validated when the app starts (`init()` or `listen()`), with any Standard Schema library. If a variable is missing or invalid, the app doesn't start and the error lists every failing variable.
- Errors never show a variable's value: if a custom message includes it, it's replaced with `***`, even when it's short or nested inside the source. Only whole occurrences are replaced, so the rest of the message stays readable.
- Declaring `Register` types `inject(CONFIG)`: `config.PORT` is a `number`, not the string `"3000"`.
- The result is frozen deeply, nested objects and arrays included, so no code can change the configuration at runtime. With a regular `z.object()`, it only contains the declared variables, not the rest of `process.env`.
- Outside the container (for example, to pass the port to `listen()`), use `app.get(CONFIG)` after `await app.init()`: `get()` can't be called before the app starts.
- It reads `process.env` by default; `env` accepts any object, for example one loaded from a file or built in a test.
- viga doesn't read `.env` files: Node does it with `node --env-file=.env`.
- The schema must validate synchronously.

## viga/pagination

```ts
import { Paginate, type PageContext } from 'viga/pagination';

@Get()
@Paginate({ defaultLimit: 20, maxLimit: 100 })
@Validate({ query: BookFilter })
async list({ page, query }: PageContext<{ query: typeof BookFilter }>) {
  const [books, total] = await this.books.findPage(query, page.offset, page.limit);
  return page.result(books, total);
}
```

```json
{
  "data": [ … ],
  "meta": { "total": 95, "page": 2, "lastPage": 5, "next": "/api/books?status=open&page=3&limit=20", "prev": "/api/books?status=open&page=1&limit=20" }
}
```

- `@Paginate` reads `?page` and `?limit`, and gives the handler `page.page`, `page.limit` and `page.offset` for your query. viga doesn't query the database: it works with any ORM.
- `page.result(items, total)` builds the response. It's generic, so returning `Book[]` makes the handler return `PaginatedResult<Book>`; export that type to share it with your frontend.
- `next` and `prev` are relative links that keep the other query parameters. They're never built from the `Host` header, so a forged host can't turn them into links to another domain.
- A `limit` above `maxLimit` (100 by default) is capped instead of rejected, so `?limit=1000000` can't make the database return a whole table. `maxPage` (1000 by default) and `maxOffset` (10,000 rows by default) cap how deep a client can go, because a huge `OFFSET` is slow even when it returns nothing. The highest allowed page depends on the `limit`: with `limit=100` it's 101. For deeper lists, use cursor pagination (`WHERE id > :last`).
- An invalid `page` (not an integer, below 1, beyond `maxPage` or `maxOffset`, or repeated) responds 400 `errors.invalidPage` with the highest allowed page in the message; an invalid `limit` responds 400 `errors.invalidLimit`.
- With `@Validate({ query })`, the schema must accept `page` and `limit` (a non-strict `z.object()` does).

## viga/drizzle

```ts
import { DatabaseService, DrizzleModule } from 'viga/drizzle';
import * as schema from './schema.ts';

declare module 'viga/drizzle' {
  interface Register {
    schema: typeof schema;
  }
}

@Module({
  imports: [DrizzleModule.forRoot({ connection: envs.DATABASE_URL, schema }), BooksModule],
})
class AppModule {}

@Injectable()
class BooksRepository {
  private readonly database = inject(DatabaseService);

  findAll() {
    return this.database.db.query.books.findMany();
  }
}
```

- `DrizzleModule.forRoot()` is global and is registered once, in the root module.
- `connection` accepts a URL or the full `pg` `Pool` configuration.
- The pool has limits by default: `statement_timeout` of 30 seconds (the same as the request timeout), `connectionTimeoutMillis` of 10 seconds and `idle_in_transaction_session_timeout` of 60 seconds, so a slow query or a forgotten transaction can't hold connections forever. Your `connection` overrides any of them.
- At startup, viga warns if it connects without TLS to a host that isn't local, or if TLS has `rejectUnauthorized: false`. In production use `?sslmode=verify-full` or `ssl: { ca }`.
- Declaring `Register` types `database.db` with your schema.
- The pool is closed by `app.close()`. Errors from idle connections go to the logger and don't crash the process.

### Transactions

Repositories always use `database.db`. Outside a transaction it is the regular connection; inside one, it is the current transaction, without passing it as a parameter.

```ts
@Injectable()
class ReceiptsService {
  private readonly database = inject(DatabaseService);
  private readonly entries = inject(InventoryEntryRepository);
  private readonly movements = inject(StockMovementRepository);
  private readonly orders = inject(PurchaseOrderRepository);

  receive(orderId: number, lines: ReceivedLine[]) {
    return this.database.transaction(async () => {
      const entry = await this.entries.create(orderId, lines);
      await this.movements.recordEntry(entry);
      await this.orders.markReceived(orderId);
      return entry;
    });
  }
}
```

If any step throws, everything is rolled back. It is also available as a decorator:

```ts
@Transactional()
async receive(orderId: number, lines: ReceivedLine[]) { … }

@Transactional({ isolationLevel: 'serializable' })
async adjustStock(…) { … }
```

- **Nested:** a transaction inside another creates a savepoint. If the inner one fails and you catch the error, only its own work is rolled back; if you don't catch it, everything is.
- **Configuration** (`isolationLevel`, `accessMode`, `deferrable`): only on the outer transaction. A nested one that tries to change it throws.
- `database.inTransaction()` tells whether one is in progress. `database.root` is always the connection outside any transaction.
- **Raw SQL:** use `database.db.execute(sql\`…\`)`, which respects the current transaction. Using `database.pool` directly bypasses it.
- Don't run nested transactions in parallel (`Promise.all`) inside the same transaction: they share a single connection.

Another ORM? No adapter needed: register it as a provider with `onModuleDestroy`.

```ts
@Injectable()
class Database implements OnModuleDestroy {
  readonly client = new PrismaClient();

  onModuleDestroy() {
    return this.client.$disconnect();
  }
}
```

## viga/websocket

```ts
import { z } from 'zod';
import { Gateway, OnMessage, WebSocketModule, WsServer, type WsContext } from 'viga/websocket';

const Join = z.object({ room: z.string().min(1) });
const Say = z.object({ room: z.string(), text: z.string().max(500) });

@Gateway('/chat')
class ChatGateway {
  private readonly server = inject(WsServer);

  @OnMessage('join', Join)
  join({ client, data }: WsContext<typeof Join>) {
    client.join(data.room);
    return { joined: data.room };
  }

  @OnMessage('say', Say)
  say({ client, data }: WsContext<typeof Say>) {
    this.server.to(data.room).send('said', { from: client.state.userId, text: data.text }, { except: client });
  }
}

@Module({
  imports: [
    WebSocketModule.forRoot({
      authenticate: async (req) => verifySession(req.headers.cookie),
      allowedOrigins: ['https://my-frontend.com'],
    }),
    ChatModule,
  ],
})
class AppModule {}
```

- Gateways are providers: list them in a module's `providers`. They use the same port as HTTP and `inject()` like any service.
- Messages are JSON: `{ "event": "join", "data": { … }, "id": 1 }`. The handler's return value is sent back as `{ event, data, id }`; an `async function*` sends one message per yielded value. Errors arrive as `{ "event": "error", "data": { statusCode, code, message, details? }, id }`, with the same codes as HTTP and without leaking internal messages.
- Rooms: `client.join(room)`, `client.leave(room)`, `client.rooms`, and `inject(WsServer).to(room).send(event, data, { except })` or `.broadcast(…)`. A client can be in several rooms and leaves all of them when it disconnects. Rooms live in memory: with several instances, a message doesn't reach clients connected to another one.
- A browser's `WebSocket` can't send custom headers: the handshake only carries the URL, cookies, `Origin` and `Accept-Language`. Authenticate with the session cookie (or a short-lived token in the URL, keeping in mind that URLs end up in logs), not with `Authorization`.
- With `i18n`, the language is negotiated once in the handshake (`resolveLocale` first, then `Accept-Language`, then the default) and applies to every message of that connection: `i18n.t()` and `i18n.locale()` work inside gateways, error messages are translated, and `client.locale` holds it.
- Like HTTP routes, private gateways without `authenticate` log a warning at startup, and the public ones are listed at `debug` level.
- `client.state` holds connection data. Whatever `authenticate` returns (an object) is stored there.
- Authentication only happens at the handshake, so a session must expire on its own. If `authenticate` returns `expiresAt` (a `Date` or milliseconds, for example a JWT's `exp * 1000`), the connection closes with 1008 `Session expired` at that moment and `onDisconnect` runs. A handshake whose session already expired responds 401, and an `expiresAt` that isn't a valid date responds 500 and logs an error instead of being ignored. `client.expiresAt` reads it and `client.expireAt(date)` renews it, for example after a token refresh sent over the socket; `client.expireAt(undefined)` removes it. To revoke a session at once, close its clients from `WsServer.clients`.
- `RateLimit` from `viga/websocket` limits one event (on the method) or every event of a gateway (on the class), on top of `messageRateLimit`. It counts per connection by default; `key: ({ client }) => String(client.state.userId)` counts per user across tabs. Above the limit it responds `errors.tooManyRequests` with `details.retryAfter` in seconds. The `@RateLimit` from `viga` is for HTTP routes only.
- `@UseGuards` and `@UseInterceptors` work per message, on the method or the whole gateway. `OnWsConnection` and `OnWsDisconnect` are lifecycle hooks for each connection.
- `ws` is loaded only when a gateway exists: `pnpm add ws`.

| `WebSocketModule.forRoot` option | Default | What it controls |
|---|---|---|
| `authenticate` | none | Checks the handshake request. Gateways are private by default: without `authenticate`, only `@Public()` gateways accept connections. Returning `false` responds 401 |
| `handshakeTimeoutMs` | `10_000` | If `authenticate` takes longer, the handshake responds 503 and a warning is logged, so a slow auth service can't pile up open sockets |
| `allowedOrigins` | `[]` | List or function. A request with an `Origin` that isn't allowed responds 403 (prevents cross-site WebSocket hijacking). Requests without `Origin` (non-browser clients) are accepted |
| `maxConnections` | `10_000` | Simultaneous connections across all gateways, counting handshakes still in progress. Above it, the handshake responds 503. It's a global limit; for a limit per client, use `connectionsPerKey` |
| `maxPendingHandshakes` | `100` | Handshakes still checking `Origin` or running `authenticate` at the same time, including unknown paths with `concealRoutes`. Above it, the handshake responds 503 without calling `authenticate`, so a flood of upgrades can't run thousands of auth queries in parallel |
| `connectionsPerKey` | `{ max: 50 }` | Limits simultaneous connections per client, counting handshakes still in progress; above it, the handshake responds 429. By default the key is the client IP resolved with the app's `trustProxy`, normalized with `ipKey()` (IPv6 grouped by /56). If a handshake carries `X-Forwarded-For` that `trustProxy` doesn't trust, viga logs a warning once, because every client behind that proxy would share one counter. `key` receives the handshake request to count by something else; returning `undefined` skips the limit. `false` disables it |
| `maxPayload` | 100 KiB | Larger messages close the connection with 1009 |
| `messageRateLimit` | `{ max: 100, windowMs: 10_000 }` | Messages per connection, for every event, counted as they arrive, even while `onConnection` is still running. Above it, responds `errors.tooManyRequests` with `details.retryAfter`; a client that reaches twice the limit within one window is disconnected with 1008 `Too many messages`. `false` disables it. Independently, a connection that piles up more than 100 messages before `onConnection` finishes is also closed with 1008 |
| `requireValidation` | `true` | The app doesn't start if an `@OnMessage` has no schema. An event without data declares `z.undefined()` |
| `heartbeatMs` | `30_000` | Pings each client; one that doesn't answer is disconnected |
| `maxBufferedBytes` | 1 MiB | A client that doesn't read its messages is disconnected instead of filling the server's memory |
| `maxRoomsPerClient` | `100` | Rooms a connection can be in at once. Joining one more responds `errors.tooManyRooms` |
| `i18n` | none | An `I18n` instance from `viga/i18n`. Enables the per-connection language and, unless `resolveMessage` is set, translates error messages |
| `resolveLocale` | none | A header name or a function of the handshake request, read before `Accept-Language`. In browsers, read it from the URL: `(req) => new URL(req.url, 'http://localhost').searchParams.get('lang')` |
| `resolveMessage` | none | Same as in `createApp`, for error messages |
| `adapter` | `ws` | Any `WsAdapter`. The interface is public, so other libraries can be plugged in |

Switching adapter doesn't change your gateways, but it does change the client: with `ws`, the browser's native `WebSocket` works as is.

An adapter receives the gateway `paths`, `maxPayload`, `heartbeatMs`, `verify(req)` (to accept or reject each handshake) and `onConnection(connection, req)`. [`test/websocket/socket-io-adapter.ts`](test/websocket/socket-io-adapter.ts) is a complete adapter on top of socket.io, used by the test suite to check that the interface isn't tied to `ws`. With socket.io, a rejected handshake doesn't keep viga's status code (socket.io answers with its own error), and the client must be `socket.io-client`.

## Development

| Script | What it does |
|---|---|
| `pnpm test` | Tests with Node's native runner. PostgreSQL tests are skipped |
| `pnpm db:test:up` / `db:test:down` | Starts or stops a disposable PostgreSQL on port 55432 (in-memory data) |
| `pnpm test:db` | All tests, PostgreSQL ones included (requires `db:test:up`) |
| `pnpm test:coverage` | Tests with a coverage report of `src/` (run it with `VIGA_TEST_DATABASE_URL` set to include PostgreSQL). Lines that only contain types can show as uncovered |
| `pnpm check-types` | Type checks |
| `pnpm build` | Compiles to `dist/` with `tsc` (JS + types) |
| `pnpm pack` | Builds the `.tgz` that would be published, to try it in another project |

`prepublishOnly` runs type checks, every test (with PostgreSQL) and the build before each `npm publish`.

## Contributing

viga is a personal project maintained in my spare time, so I'm not accepting pull requests or issues. You are welcome to fork it under the MIT license.

## License

[MIT](LICENSE)
