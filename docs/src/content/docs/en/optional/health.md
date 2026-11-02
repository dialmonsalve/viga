---
title: '@vigajs/core/health'
description: Add the /health and /ready routes so Kubernetes, Docker or a load balancer know whether your app is alive and ready to receive traffic.
sidebar:
  order: 8
---

Kubernetes, Docker and load balancers periodically ask your app how it's doing, to restart it or stop sending it traffic if something goes wrong. `@vigajs/core/health` adds the two routes they need:

| Route | Question | What it does | If it fails |
| --- | --- | --- | --- |
| `GET /health` | Is the process still alive? | It responds 200, without touching any dependency. | The app is restarted. |
| `GET /ready` | Can it serve requests? | It runs your checks and responds 200 or 503. | It stops receiving traffic, without being restarted. |

`/health` doesn't check the database on purpose: if the database goes down, restarting the app doesn't fix it, and restarting every instance at once only makes things worse.

## Add the routes

Import `HealthModule` in the root module and declare what has to work for the app to be ready:

```ts title="src/app.module.ts"
import { Module, inject } from '@vigajs/core';
import { CONFIG, ConfigModule } from '@vigajs/core/config';
import { DatabaseService, DrizzleModule } from '@vigajs/core/drizzle';
import { HealthModule } from '@vigajs/core/health';
import { Env } from './config.ts';

@Module({
  imports: [
    ConfigModule.forRoot({ schema: Env }),
    DrizzleModule.forRoot(() => ({ connection: inject(CONFIG).DATABASE_URL })),
    HealthModule.forRoot(() => {
      const database = inject(DatabaseService);

      return {
        checks: {
          database: () => database.ping(),
        },
      };
    }),
  ],
})
export class AppModule {}
```

Both routes respond:

```json
{ "status": "ok" }
```

The `forRoot` function runs inside the container at startup, so it can ask for values with `inject()`, but it only sees the providers of global modules. `DatabaseService` is one of them, and to use another service, export it from a [global module](../../core/modules/#global-modules).

If you don't need `inject()`, pass an object: `HealthModule.forRoot({ checks: { ... } })`. With no checks, `HealthModule.forRoot()` makes `/ready` always respond 200.

## The checks

A check is a function that can be `async`. It fails if:

- it throws an error or its promise rejects,
- it returns `false`,
- it doesn't finish in time.

Any other result counts as a pass. `DatabaseService.ping()` runs `SELECT 1` and throws if PostgreSQL doesn't respond.

Check only what prevents the app from serving requests. If your app can work without a service, for example by showing stale data when a cache fails, leave it out: its outage would leave the whole app without traffic.

Also avoid checking third-party APIs. If one goes down, all your instances stop being ready at once, and your app stops responding to everything.

## What the caller sees

These routes are public, even if the app has an [authentication guard](../../core/guards/#the-authentication-guard), because whoever calls them has no session. That's why they give no details. If a check fails, the response is only:

```json
{ "status": "unavailable" }
```

Which check failed, and why, goes to the [logger](../../core/providers/#use-your-own-logger), which is where you'll look for it:

```txt
[Health] The health check "database" failed
```

That way, the response doesn't reveal what infrastructure you use or the contents of errors, which often include internal addresses. If you don't want to expose the routes on the internet, don't publish them on your proxy: Kubernetes probes call the app directly.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `checks` | `{}` | The checks, with their names for the log. |
| `timeoutMs` | `3_000` | How long each check can take. If it takes longer, it fails. |
| `cacheMs` | `1_000` | How long the last result is reused. With `0`, it checks on every request. |

Since `/ready` is public, anyone could call it in a loop to overload your database. That's why simultaneous requests share a single run of the checks, and the result is reused for `cacheMs`. With the default value, each instance runs them at most once per second, however many requests it receives.

Keep `timeoutMs` below the time your probe waits for a response. Otherwise, the probe gives up before viga responds.

### Other routes

Routes go in the second argument, because viga has to know them before creating the providers:

```ts
HealthModule.forRoot(options, { path: '/live', readyPath: '/status' });
```

Like other routes, they carry the app's [`globalPrefix`](../../core/controllers/): with `globalPrefix: '/api'`, they end up at `/api/health` and `/api/ready`.

## With Kubernetes

```yaml
spec:
  terminationGracePeriodSeconds: 40
  containers:
    - name: api
      startupProbe:
        httpGet: { path: /health, port: 3000 }
        periodSeconds: 2
        failureThreshold: 30
      livenessProbe:
        httpGet: { path: /health, port: 3000 }
        periodSeconds: 10
      readinessProbe:
        httpGet: { path: /ready, port: 3000 }
        periodSeconds: 5
        timeoutSeconds: 4
      lifecycle:
        preStop:
          exec:
            command: ['sleep', '5']
```

The app starts responding when it finishes starting, after the `onModuleInit` hooks, so `startupProbe` gives it up to a minute to do so without `livenessProbe` restarting it.

### When deploying a new version

`/ready` doesn't announce that the app is shutting down. On receiving `SIGTERM`, [`close()`](../../core/app-lifecycle/#stopping) stops accepting connections immediately, and Kubernetes can take a few seconds to stop sending it traffic, so some requests would fail.

That's why the example uses `preStop`: it waits 5 seconds before sending `SIGTERM`, so Kubernetes removes the instance while it's still serving requests. Set `terminationGracePeriodSeconds` to include that wait and the time in-flight requests take to finish. The command needs `sleep` in the image; minimal images, like *distroless* ones, don't have it.

## With Docker

Node.js images don't always include `curl`, but they do include Node.js:

```dockerfile
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
```

## Rate limits

Probes are normal requests, so they count toward a global [`rateLimit()`](../../security/rate-limiting/#for-the-whole-app), and a 429 on `/ready` is treated as a failure. With a probe every few seconds and a reasonable limit that's not a problem, but keep it in mind if the limit is very low.

## In tests

`/ready` is tested like any route with [`createTestingApp`](../testing/). To simulate a failure, replace `HEALTH_OPTIONS`:

```ts title="test/health.test.ts"
import { HEALTH_OPTIONS } from '@vigajs/core/health';
import { createTestingApp } from '@vigajs/core/testing';

const app = await createTestingApp(AppModule, {
  overrides: [{ provide: HEALTH_OPTIONS, useValue: { checks: { database: () => false } } }],
});

const response = await app.request('/ready');
assert.equal(response.status, 503);

await app.close();
```

If you need the same result from your code, `HealthService` is available with `inject()` and its `isReady()` method returns `true` or `false`.
