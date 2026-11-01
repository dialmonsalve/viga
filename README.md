# viga

**English** · [Español](README.es.md) · [Documentation](https://vigajs.dev/en/)

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
| `viga/testing` | `createTestingApp` to test the app with real HTTP requests and replaced providers | Nothing |

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

Routes are private by default: without `@Public()`, `GET /api/v1/books` would respond 401 until you set a guard with `app.useAuthGuard()` (see [Guards](https://vigajs.dev/en/core/guards/)).

## Core (`viga`)

### Modules and dependency injection

See [Modules](https://vigajs.dev/en/core/modules/) and [Providers and dependency injection](https://vigajs.dev/en/core/providers/) in the documentation.

### Lifecycle

See [App lifecycle](https://vigajs.dev/en/core/app-lifecycle/) in the documentation.

### Private routes by default

See [Guards](https://vigajs.dev/en/core/guards/) in the documentation. The same rules, `@Public` not being inherited included, apply to `viga/websocket` gateways.

### Request order

See [Request lifecycle](https://vigajs.dev/en/core/request-lifecycle/) in the documentation.

### Guards and interceptors

See [Guards](https://vigajs.dev/en/core/guards/) and [Interceptors](https://vigajs.dev/en/core/interceptors/) in the documentation.

### Request context

See [The request context](https://vigajs.dev/en/core/request-lifecycle/#the-request-context) in the documentation.

### Express middlewares

See [Express middlewares](https://vigajs.dev/en/core/request-lifecycle/#express-middlewares) in the documentation.

### Security defaults

See [Security defaults](https://vigajs.dev/en/security/defaults/) in the documentation. These defaults reduce common risks, but they don't make an application secure on their own.

- `trustProxy` (not trusted by default) works like Express's `trust proxy`. Behind a proxy, set it to the number of proxies in front of the app (for example `1`) so `req.ip` is the client's. Avoid `true`: the client can forge `X-Forwarded-For` to bypass rate limits, and viga logs a warning.

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

See [Exceptions](https://vigajs.dev/en/core/exceptions/) in the documentation.

### Developer messages

See [Developer messages](https://vigajs.dev/en/optional/i18n/#developer-messages) in the documentation.

### Logger

See [Use your own logger](https://vigajs.dev/en/core/providers/#use-your-own-logger) in the documentation.

## viga/validation

See [viga/validation](https://vigajs.dev/en/optional/validation/) in the documentation.

## viga/i18n

See [viga/i18n](https://vigajs.dev/en/optional/i18n/) in the documentation.

## viga/config

See [viga/config](https://vigajs.dev/en/optional/config/) in the documentation.

## viga/pagination

See [viga/pagination](https://vigajs.dev/en/optional/pagination/) in the documentation.

## viga/drizzle

See [viga/drizzle](https://vigajs.dev/en/optional/drizzle/) in the documentation.

## viga/websocket

See [viga/websocket](https://vigajs.dev/en/optional/websocket/) in the documentation.

## viga/testing

See [viga/testing](https://vigajs.dev/en/optional/testing/) in the documentation.

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
