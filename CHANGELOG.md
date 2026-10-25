# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). While the version is `0.x`, minor releases may include breaking changes.

## [0.1.0] - Unreleased

First public release.

### Core (`viga`)

- Modules with `imports`, `exports`, re-exports and global modules (which must be imported by the root module).
- Dependency injection with `inject()` in class fields: class, `useClass`, `useValue` and `useFactory` providers, `InjectionToken`, and detection of circular dependencies and imports.
- Controllers with standard TC39 decorators, `@HttpCode`, guards, interceptors and `@Public`.
- Private routes by default through `app.useAuthGuard()`.
- Lifecycle hooks `OnModuleInit` and `OnModuleDestroy`, `close()` that only closes providers that finished starting, and `enableShutdownHooks()`.
- Per-request context with `createContextKey` and `runInNewContext`.
- Secure defaults: security headers, body size limit, server timeouts, request id, `X-Powered-By` disabled, and the optional `requireValidation` and `concealRoutes`.
- Rate limiting with `rateLimit()` and `@RateLimit()`, with a pluggable store.
- HTTP exceptions with stable codes, `resolveMessage` and developer diagnostics that can be translated with `setDiagnostics`.
- `listen()` defaults to port 3000.

### `viga/validation`

- `@Validate` for `body`, `query` and `params` with any Standard Schema library.
- `ValidationModule.forRoot({ formatIssue })` to customize or translate validation messages.

### `viga/i18n`

- `I18n` with nested catalogs, `Accept-Language` negotiation, `resolveLocale` (header name or function), and framework messages in English and Spanish.
- `diagnosticsEs`, the Spanish dictionary for developer messages.

### `viga/drizzle`

- `DrizzleModule.forRoot()` and `DatabaseService` with pool shutdown.
- Transactions with `database.transaction()` and `@Transactional()`, nested savepoints and isolation options.

[0.1.0]: https://github.com/dialmonsalve/viga/releases/tag/v0.1.0
