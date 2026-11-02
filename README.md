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
| `viga/health` | `/health` and `/ready` routes with your own checks, without revealing details | Nothing |
| `viga/crypto` | Password hashing with Argon2id, random tokens, signed URLs and AES-256-GCM encryption | Nothing |
| `viga/events` | In-memory event bus with typed events, isolated errors and listeners that finish before shutdown | Nothing |
| `viga/workers` | The same worker in the API, in child processes or on another server, with a supervisor that restarts them | Nothing |
| `viga/upload` | `@Upload` with limits, file types detected from the content and automatic cleanup | `multer`, `file-type` |

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

Only if you use `viga/upload`:

```bash
pnpm add multer file-type
```

Or create a project with `pnpm create viga my-app`.

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

See [Security defaults](https://vigajs.dev/en/security/defaults/) and [Client IP and proxies](https://vigajs.dev/en/security/client-ip/) in the documentation. These defaults reduce common risks, but they don't make an application secure on their own.

### Rate limiting

See [Rate limiting](https://vigajs.dev/en/security/rate-limiting/) in the documentation.

### Security testing checklist

See [Security testing checklist](https://vigajs.dev/en/security/checklist/) in the documentation.

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

## viga/health

See [viga/health](https://vigajs.dev/en/optional/health/) in the documentation.

## viga/crypto

See [viga/crypto](https://vigajs.dev/en/optional/crypto/) in the documentation.

## viga/events

See [viga/events](https://vigajs.dev/en/optional/events/) in the documentation.

## viga/workers

See [viga/workers](https://vigajs.dev/en/optional/workers/) in the documentation.

## viga/upload

See [viga/upload](https://vigajs.dev/en/optional/upload/) in the documentation.

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
