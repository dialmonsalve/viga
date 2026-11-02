---
title: Rate limiting
description: Limit how many requests a client can make in a period of time, app-wide or per route, and how to pick the counter's key and store.
sidebar:
  order: 2
---

A rate limit counts how many requests each client makes within a time window and, if it goes over the maximum, responds 429 until the window ends. It helps slow down brute-force attacks against login, abuse of expensive routes, or scripts that call your API nonstop.

In HTTP it's **off** by default: you decide where to put it. It isn't turned on by itself because, behind a misconfigured proxy, every user would share the proxy's IP and be blocked at once. Read [Client IP and proxies](../client-ip/) before turning it on. WebSocket does have a per-connection limit on by default, as explained in [`@vigajs/core/websocket`](../../optional/websocket/#default-limits).

## For the whole app

`rateLimit()` is a middleware that limits every request of each client:

```ts title="src/main.ts"
import { createApp, rateLimit } from '@vigajs/core';

const app = createApp({ rootModule: AppModule }).enableShutdownHooks();
app.use(rateLimit({ max: 300, windowMs: 60_000 }));
```

Here each IP can make 300 requests per minute, adding up all routes.

## Per route

`@RateLimit()` gives a route its own limit, or every route of a controller if you put it on the class. It's the right fit for sensitive routes, like login:

```ts title="src/auth/auth.controller.ts"
import { Controller, Post, Public, RateLimit, type HttpContext } from '@vigajs/core';
import { Validate } from '@vigajs/core/validation';
import { z } from 'zod';

const Login = z.object({ email: z.email(), password: z.string() });

@Public()
@Controller('/auth')
export class AuthController {
  @Post('/login')
  @RateLimit({ max: 5, windowMs: 15 * 60_000 })
  @Validate({ body: Login })
  login({ body }: HttpContext<{ body: typeof Login }>) {
    return this.auth.login(body);
  }
}
```

Each limit has its own counter. If the app has a global limit and a route has its own, a request to that route counts in both.

`@RateLimit()` is a guard, so it runs with the other [route guards](../../core/guards/#the-order-they-run-in), before validation and the method.

## The response

Every response carries three headers with the counter's state:

| Header | What it tells |
| --- | --- |
| `RateLimit-Limit` | The window's maximum number of requests. |
| `RateLimit-Remaining` | How many are left. |
| `RateLimit-Reset` | How many seconds until the window resets. |

When the client goes over the maximum, the response is a 429 with the code `errors.tooManyRequests` and the `Retry-After` header, which says how many seconds to wait.

## The counter's key

The counter is kept per key: two requests with the same key add to the same counter. By default, the key is the client's IP, normalized with `ipKey()`:

- An IPv4 address written as IPv6, like `::ffff:1.2.3.4`, counts as its IPv4, `1.2.3.4`.
- An IPv6 address counts as its `/56` network. Whoever controls an IPv6 address usually controls the whole block, and without this they could get a fresh counter with each address.

### A key of your own

The `key` option receives the request and returns the key. For login, limiting by IP and email together slows down someone trying many passwords for the same account, without blocking other users on the same network:

```ts
import { RateLimit, ipKey } from '@vigajs/core';

@RateLimit({
  max: 5,
  windowMs: 15 * 60_000,
  key: (req) => `${ipKey(req.ip ?? '')}:${req.body?.email}`,
})
```

Use `ipKey()` whenever you build a key from the IP, so IPv6 addresses are grouped the same way as in the default key. `ipKey(address, 64)` groups by another network length.

The key can use the body because `@RateLimit()` runs after it's read. But it isn't validated yet: treat it as data coming from the client. Keys longer than 128 characters are stored as a hash, so a huge value doesn't take up more memory.

## Where the counter is stored

By default, the counter lives in the process's memory, in a `MemoryRateLimitStore`. So it can't exhaust memory:

- It stores 10,000 keys at most. You can change that with `new MemoryRateLimitStore({ maxKeys })`, passed in the `store` option.
- When it's full, it first evicts the oldest key seen only once. That way, a flood of new keys, for example with made-up emails, can't erase the counter of a key under attack.
- If every stored key is live and repeated, it treats a new key as already over the limit until one expires: when in doubt, it rejects instead of letting through. If legitimate traffic can fill it, raise `maxKeys`.

### Several instances

The in-memory counter belongs to each process. If your app runs on several instances, each one counts on its own and the real limit is multiplied by the number of instances. To share the counter, implement the `RateLimitStore` interface on Redis or another shared store and pass it in `store`:

```ts
import type { RateLimitHit, RateLimitStore } from '@vigajs/core';

export class SharedRateLimitStore implements RateLimitStore {
  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    ...
  }
}
```

`hit` adds one request to the key and returns how many it has (`count`) and when the window resets (`resetAt`, in milliseconds since 1970). With Redis, the usual approach is an `INCR` of the key and, if it's the first request, a `PEXPIRE` with the window's length, both in one transaction.

## Fixed window

The window is fixed: it starts with the first request and lasts `windowMs`. A client can make `max` requests at the end of one window and another `max` at the start of the next, so in a short time it can reach twice the limit. Pick `max` with that burst in mind.

## In WebSocket

To limit a gateway's events, use the `RateLimit` imported from `@vigajs/core/websocket`, not the one from `@vigajs/core`. It's explained in [`@vigajs/core/websocket`](../../optional/websocket/#guards-interceptors-and-per-event-limits).
