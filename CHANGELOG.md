# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). While the version is `0.x`, minor releases may include breaking changes.

## [0.1.2] - 2026-11-02

### Changed

- Back to a single package: every module is included and needs no extra install. The docs, `viga generate` and `@vigajs/create` now use the alias `viga@npm:@vigajs/core`, so code imports from `viga` and `viga/validation`. The separate `@vigajs/<module>` packages from 0.1.1 are deprecated.

## [0.1.1] - 2026-11-02

### Added

- Each optional module is also its own package, so imports are shorter: `@vigajs/validation` instead of `@vigajs/core/validation`. They are thin re-exports of `@vigajs/core`, and its subpaths keep working.

### Fixed

- `inject(CONFIG)` lost the type registered through `declare module` in installed packages, so its values were `unknown`.

## [0.1.0] - 2026-11-02

First public release.

### Generator

- `viga generate` (`viga g`) creates a `resource`, `module`, `controller` or `service`. It has no dependencies, never changes existing files and prints what to register by hand.

### `@vigajs/create`

- `pnpm create @vigajs my-app`, also with npm, yarn and bun, creates a project with its scripts, TypeScript configuration and a first module. It has no dependencies and runs no installs.

### Core (`@vigajs/core`)

- Modules with `imports`, `exports`, re-exports and global modules (which must be imported by the root module).
- Dependency injection with `inject()` in class fields: class, `useClass`, `useValue` and `useFactory` providers, `InjectionToken`, and detection of circular dependencies and imports.
- Inside a controller, routes are sorted by specificity, so `/export` wins over `/:id` whatever the declaration order. Startup fails on routes that match the same requests, and warns when a route in another controller shadows a later one.
- Controllers with standard TC39 decorators, `@HttpCode`, guards, interceptors and `@Public`. Every guard, including method guards and `@RateLimit`, runs before any interceptor, in HTTP and WebSocket, so a caching interceptor can't skip them. `@Public` isn't inherited: subclasses and overridden methods are private until they declare it again.
- Private routes by default through `app.useAuthGuard()`. Startup warns when private routes have no auth guard and lists the public routes at debug level (also for WebSocket gateways).
- Lifecycle hooks `OnModuleInit` and `OnModuleDestroy`, `close()` that only closes providers that finished starting, and `enableShutdownHooks()`, which exits with the signal's standard code (also as PID 1 in a container).
- Per-request context with `createContextKey` and `runInNewContext`.
- Security defaults: security headers, body size limit, server timeouts, request id, `X-Powered-By` disabled, `requireValidation` on by default (a route without a body schema doesn't parse a body and answers 400 `errors.unexpectedBody` when one arrives, and `ctx.req.body` holds the validated value), `concealRoutes` on by default when there is an auth guard (which also covers WebSocket handshakes), and a body parsed only on existing routes and after authentication. `trustProxy: true` logs a warning because it lets clients forge their IP. CSRF protection (`csrf`) rejects, before parsing the body, cross-site `POST` requests a browser can send without a CORS preflight, with `trustedOrigins` for callbacks such as OAuth `form_post`.
- Rate limiting with `rateLimit()` and `@RateLimit()`, with a pluggable store. The default key groups IPv6 clients by /56 network and IPv4-mapped addresses by their IPv4, through the exported `ipKey()`. The exported `CLIENT_IP` token resolves the client IP with the app's `trustProxy` from a raw Node.js request, such as a WebSocket handshake. The in-memory store is bounded (`maxKeys`), hashes long keys, and when full evicts only keys seen once, so a flood of new keys can't reset a counter under attack; with no room left it fails closed.
- HTTP exceptions with stable codes, `resolveMessage` and developer diagnostics that can be translated with `setDiagnostics`. `HttpException` covers any other status; when its message is free text, the response `code` is `errors.badRequest` for 4xx and `errors.internal` for 5xx. A failure after the response started is logged once and closes the connection.
- `listen()` defaults to port 3000.
- `@vigajs/core/tsconfig.json`, a base TypeScript configuration to extend, so a project only needs `extends` and `include`.
- `OnServerListen`, `OnServerClose` and `OnDrain` lifecycle hooks. `OnDrain` runs once in-flight requests have finished and before any `onModuleDestroy`.
- `createContextKey(name, { detached: true })` for values that must not reach `@vigajs/core/events` listeners, such as a transaction.
- Guards and interceptors accept a context type, so they can be used outside HTTP.

### `@vigajs/core/validation`

- `@Validate` for `body`, `query` and `params` with any Standard Schema library, typed against the handler's context (which may extend `HttpContext`). Each error's `code` comes from the library's `code` or `type` field, so it works with Zod, Valibot and ArkType.
- `ValidationModule.forRoot({ formatIssue })` to customize or translate validation messages.

### `@vigajs/core/i18n`

- `I18n` with nested catalogs, `Accept-Language` negotiation, `resolveLocale` (header name or function), and framework messages in English and Spanish.
- `diagnosticsEs`, the Spanish dictionary for developer messages.

### `@vigajs/core/health`

- `HealthModule.forRoot()` adds public `/health` and `/ready` routes (configurable, under `globalPrefix`). `/health` never runs the checks; `/ready` answers 503 if a check throws, returns `false` or exceeds `timeoutMs`. Responses carry no details, failures go to the logger, concurrent requests share one run and the result is cached for `cacheMs`.
- `DatabaseService.ping()` in `@vigajs/core/drizzle`.

### `@vigajs/core/crypto`

- `hashPassword`, `verifyPassword` and `needsRehash` with Argon2id from `node:crypto` (no dependencies), in the standard PHC format, with NFKC normalization.
- `randomToken`, `hashToken` and `safeEqual`.
- `CryptoModule.forRoot()` with `UrlSigner` and `@Signed()` for signed URLs with expiry, bound to the path, query and method, and `Encryptor` for AES-256-GCM with a context that binds a value to its owner. Both support key rotation and refuse keys under 32 bytes at startup.

### `@vigajs/core/events`

- `EventsModule.forRoot()`, `EventBus` and `@OnEvent` for an in-memory event bus with class-based events. `emit()` resolves when every listener has finished and never rejects; listener errors are logged and isolated.
- Listeners inherit a copy of the context without `detached` keys, so they don't join the emitter's transaction. Emitting inside a transaction logs a warning.
- Shutdown waits for running listeners, up to `drainTimeoutMs`, before any `onModuleDestroy`.

### `@vigajs/core/workers`

- `WORKER_KEY`, `WorkerModule.forKey()` and `startWorker()` so the same worker module runs inside the API, as a child process or on another server, without a queue library of its own. A worker closes in an orderly way on a signal and when its parent dies, with `orphanTimeoutMs` as a limit in the second case.
- `WorkersModule.forRoot()` and `WorkerSupervisor` fork one process per key, with `start`, `stop` and `list`, restart with backoff, a graceful stop that ends in `SIGKILL` after `stopTimeoutMs`, and a `maxWorkers` limit (8 by default).

### `@vigajs/core/upload`

- `@Upload()` over Multer and `file-type`, both optional peer dependencies. It reads files after authentication and guards, requires `types` or `check`, detects the type from the content, stores files under generated names in a temporary folder and removes what isn't moved with `moveTo` when the response ends, also when a request fails or is cut off. Text fields are rejected unless the route uses `@Validate({ body })`. `optional: true` with `OptionalUploadContext` covers forms where the file may be absent.

### `@vigajs/core/websocket`

- `WebSocketModule.forRoot()` (an object or a function that runs in the container and can use `inject()`, also in `DrizzleModule.forRoot()`), `@Gateway`, `@OnMessage` with Standard Schema validation, `WsContext` and `WsServer`.
- Rooms with `join`, `leave`, `to(room).send()` and `broadcast()`, limited per connection by `maxRoomsPerClient`.
- Per-connection language with `i18n` and `resolveLocale`, applied to every message and to error messages.
- `RateLimit` per event or per gateway, keyed per connection by default or by any value of the context, sharing the bounded in-memory store with HTTP.
- Public `WsAdapter` interface, with a default adapter on top of `ws` that is loaded only when needed. Adapters receive the gateway paths; a socket.io adapter in the test suite checks that the interface works beyond `ws`.
- Security defaults: private gateways, handshake authentication with a timeout (`handshakeTimeoutMs`), session expiry from the `expiresAt` that `authenticate` returns (closes with 1008, renewable with `client.expireAt()`), a cap on simultaneous connections (`maxConnections`), a cap per client IP on by default (`connectionsPerKey`, 50, using `trustProxy` and grouping IPv6 by /56), a cap on handshakes still authenticating (`maxPendingHandshakes`), `Origin` allowlist, `maxPayload`, per-connection message rate limit counted on arrival (twice the limit disconnects with 1008, as does piling up more than 100 messages before `onConnection` ends), heartbeat, slow-client protection and `requireValidation`: an event without a schema doesn't accept data and answers 400 `errors.unexpectedData` when it arrives.

### `@vigajs/core/config`

- `ConfigModule.forRoot({ schema, env? })` validates the configuration at startup with any Standard Schema library and fails listing every invalid variable, without showing their values, even short or nested ones.
- `inject(CONFIG)` is typed through `Register` and returns a deeply frozen object.

### `@vigajs/core/pagination`

- `@Paginate` with `page.offset`, `page.limit` and a generic `page.result(items, total)` that returns `PaginatedResult<T>` with `total`, `lastPage` and relative `next`/`prev` links that keep the query parameters.
- Security defaults: `maxLimit` caps the page size, `maxPage` and `maxOffset` (10,000 rows) cap the depth, invalid values respond 400, and links never use the `Host` header.

### `@vigajs/core/drizzle`

- `DrizzleModule.forRoot()` and `DatabaseService` with pool shutdown, default timeouts for statements, connections and idle transactions, and a startup warning for connections without verified TLS to a remote host.
- Transactions with `database.transaction()` and `@Transactional()`, nested savepoints and isolation options.

### `@vigajs/core/testing`

- `createTestingApp(Module, { overrides, configure })` starts the app on a free local port with the production defaults and a silent logger. `overrides` replaces providers in any module and fails on a token that matches no provider; `app.request()` returns the status, headers and parsed body.

[0.1.0]: https://github.com/dialmonsalve/viga/releases/tag/v0.1.0
