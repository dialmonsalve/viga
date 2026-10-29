---
title: App lifecycle
description: How a viga app starts and stops, the provider hooks and the orderly shutdown when a signal arrives.
sidebar:
  order: 8
---

A viga app goes through three stages: it starts, it serves requests and it stops. This page explains what happens when it starts and when it stops, and how a provider can run code at those moments, for example to connect to a database and close the connection at the end.

## Starting

`listen()` starts the app and begins listening:

```ts title="src/main.ts"
const app = createApp({ rootModule: AppModule, globalPrefix: '/api' }).enableShutdownHooks();

await app.listen();
```

When you call it, viga:

1. Loads the modules and creates every provider.
2. Runs the `onModuleInit` hook of every provider that has one.
3. Registers the controllers' routes.
4. Runs the `onServerListen` hooks.
5. Starts listening on the port.

If something fails in steps 1 to 4, the app never opens the port and `listen()` throws the error.

`listen()` listens on port 3000 unless you pass another one. `listen(8080)` uses that port, `listen(8080, '127.0.0.1')` also picks the interface, and `listen(0)` takes a random free port, which is handy in tests. viga doesn't read the `PORT` environment variable on its own; if you use it, pass it yourself: `app.listen(Number(process.env.PORT ?? 3000))`.

### Starting without a server

`init()` runs steps 1 to 3 without opening any port. It's for scripts, scheduled jobs or workers that use your services without serving HTTP requests. With `app.get()` you get any provider:

```ts title="scripts/import-books.ts"
import { createApp, runInNewContext } from 'viga';
import { AppModule } from '../src/app.module.ts';
import { BooksService } from '../src/books/books.service.ts';

const app = await createApp({ rootModule: AppModule }).init();

await runInNewContext(() => app.get(BooksService).importFromCsv('books.csv'));

await app.close();
```

`app.get()` looks up from the root module, so it only finds what that module sees: its own providers, those exported by the modules it imports and those of global modules. If `BooksService` isn't exported from `BooksModule`, `app.get(BooksService)` fails with the same error as an `inject()` that can't find its provider.

`runInNewContext` opens a context so services that use [context keys](../request-lifecycle/#the-request-context) work outside a request.

## Provider hooks

A provider can implement these interfaces to run code at each stage:

| Interface | Method | When it runs |
| --- | --- | --- |
| `OnModuleInit` | `onModuleInit()` | At startup, after every provider has been created. |
| `OnServerListen` | `onServerListen(server)` | Right before the server starts listening. |
| `OnServerClose` | `onServerClose()` | When the server starts closing. |
| `OnModuleDestroy` | `onModuleDestroy()` | At shutdown, after the server has closed. |

The methods can be `async`: viga waits for them to finish before moving on.

The most common case is a connection opened at startup and closed at the end:

```ts title="src/database/database.service.ts"
import { Injectable, type OnModuleDestroy, type OnModuleInit } from 'viga';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });

  async onModuleInit() {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
```

`onModuleInit` checks that the database answers. If it doesn't, the app doesn't start, and you find out at deploy time instead of with the first request. This is the place for the asynchronous work that can't go in a [`useFactory`](../providers/#usefactory-build-the-value-with-code), which has to return the value directly.

`OnServerListen` and `OnServerClose` are for providers that need the HTTP server, for example to handle WebSockets on the same port. `onServerListen` receives the Node.js `Server` before it starts listening. That's what `viga/websocket` uses.

### The order

viga runs the `onModuleInit` hooks in dependency order: if `CacheService` uses `DatabaseService`, the `DatabaseService` hook finishes before the `CacheService` one starts. That way, when a provider initializes, everything it uses is already ready.

The `onModuleDestroy` hooks run in reverse order: first `CacheService` and then `DatabaseService`. That way no provider loses a dependency while it's still closing.

## Stopping

`close()` stops the app in an orderly way:

1. The server stops accepting new connections and closes the idle ones.
2. The `onServerClose` hooks run.
3. viga waits for the in-flight requests to finish.
4. The `onModuleDestroy` hooks run, in reverse order.

If an `onModuleDestroy` fails, viga keeps closing the rest and, at the end, `close()` throws an `AggregateError` with every error. That way, a failure closing the cache doesn't leave the database connection open.

If the app failed halfway through startup, `close()` only closes the providers whose `onModuleInit` finished. A provider that never opened its connection doesn't try to close it.

### When a signal arrives

When you stop the app with `Ctrl+C`, or when Docker or Kubernetes stop it to deploy a new version, the system sends a signal to the process. `enableShutdownHooks()` makes viga call `close()` when it receives `SIGTERM` or `SIGINT`, instead of ending abruptly:

```ts
const app = createApp({ rootModule: AppModule }).enableShutdownHooks();
```

After closing, the process exits with the signal's standard code: 143 for `SIGTERM` and 130 for `SIGINT`, or 1 if closing failed. It exits even if something keeps the process alive, like a forgotten timer, and it also works when Node.js is the main process of a container.

Without `enableShutdownHooks()`, a signal ends the process without running the `onModuleDestroy` hooks: in-flight requests are cut off and connections aren't closed properly. Always turn it on in `main.ts`.

If you need other signals, pass them as an argument: `enableShutdownHooks(['SIGTERM', 'SIGINT', 'SIGHUP'])`.
