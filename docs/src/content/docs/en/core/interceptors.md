---
title: Interceptors
description: How to run code before and after each controller method to measure timings, transform responses, cache or translate errors.
sidebar:
  order: 5
---

An interceptor wraps the execution of a controller method. It can do something before, call the method and do something after with the result.

It is for whatever repeats across many routes and is not business logic:

- **Measuring timings**, to find the slow routes.
- **Logging activity**, for example who deleted what and when, without touching every method.
- **Giving every response the same shape**, like `{ data: ... }`.
- **Caching** responses that almost never change.
- **Translating errors**, like a duplicate database record that should come back as 409, not 500.
- **Adding headers**, like `Cache-Control` on public routes.

Without interceptors, every method would have its own `try/catch`, its own timing and its own response shape, all copied. With one, you write it once and apply it wherever it's needed.

## Your first interceptor

An interceptor is a class with an `intercept` method, which receives the request context and a `next` function. `next()` runs the controller method and returns a promise with its result:

```ts title="src/common/timing.interceptor.ts"
import { Injectable, type CallHandler, type HttpContext, type Interceptor } from 'viga';

@Injectable()
export class TimingInterceptor implements Interceptor {
  async intercept({ res }: HttpContext, next: CallHandler) {
    const start = performance.now();
    const result = await next();
    res.setHeader('Server-Timing', `app;dur=${(performance.now() - start).toFixed(1)}`);
    return result;
  }
}
```

Whatever `intercept` returns is what viga sends as the response. Here it returns the same result unchanged and only adds a header.

## Where they apply

Like guards, interceptors apply to a route, to a controller or to the whole app:

```ts title="src/books/books.controller.ts"
@UseInterceptors(TimingInterceptor)
@Controller('/books')
export class BooksController {
  @UseInterceptors(AuditInterceptor)
  @Delete('/:id')
  remove({ params }: HttpContext) {
    this.books.remove(Number(params.id));
  }
}
```

```ts title="src/main.ts"
const app = createApp({ rootModule: AppModule, globalPrefix: '/api' })
  .enableShutdownHooks()
  .useAuthGuard(AuthGuard)
  .useGlobalInterceptors(TimingInterceptor);
```

Like guards, a class interceptor can use `inject()` and doesn't need to be declared in `providers`. Those in `@UseInterceptors()` are created with the controller module's container, and global ones with the root module's. If it needs no providers, it can be a function with the same signature: `(ctx, next) => ...`.

## Transform the response

Since the interceptor decides what is returned, it can change the result. This one wraps every response in a `data` object:

```ts title="src/common/envelope.interceptor.ts"
import { Injectable, type CallHandler, type HttpContext, type Interceptor } from 'viga';

@Injectable()
export class EnvelopeInterceptor implements Interceptor {
  async intercept(_ctx: HttpContext, next: CallHandler) {
    return { data: await next() };
  }
}
```

With this interceptor, a route that returns `[{ id: 1 }]` responds `{ "data": [{ "id": 1 }] }`.

:::caution
The status code is computed from what the interceptor returns, not from what the method returned. If `remove()` returns nothing, it would respond 204; with `EnvelopeInterceptor`, the result becomes `{ data: undefined }` and the response is 200 with the body `{}`. To keep the 204, return `undefined` when the method returned nothing.
:::

## Respond without calling the method

If the interceptor doesn't call `next()`, the method doesn't run and the response is whatever the interceptor returns. That is the basis of a cache:

```ts title="src/common/cache.interceptor.ts"
import { Injectable, inject, type CallHandler, type HttpContext, type Interceptor } from 'viga';
import { CacheService } from './cache.service.ts';

@Injectable()
export class CacheInterceptor implements Interceptor {
  private readonly cache = inject(CacheService);

  async intercept({ req }: HttpContext, next: CallHandler) {
    const cached = this.cache.get(req.originalUrl);
    if (cached !== undefined) return cached;

    const result = await next();
    this.cache.set(req.originalUrl, result);
    return result;
  }
}
```

This is safe with respect to permissions: viga runs every guard before any interceptor, so a cached response never reaches someone who didn't pass authentication or the route's guards.

:::caution
This cache uses only the URL as its key, so it serves the same response to every user. Use it only on routes whose response doesn't depend on who asks. On a route like `/books/mine`, the second user would get the first user's books: include the user id in the key, for example `` `${CURRENT_USER.get().id}:${req.originalUrl}` ``, or don't cache it.
:::

`next()` can only be called once. If you call it twice, the request fails with a 500 error and the log explains why.

## Translate errors

If the method throws, `await next()` throws inside the interceptor, so you can catch the error and turn it into an HTTP response:

```ts title="src/common/database-errors.interceptor.ts"
import { ConflictException, Injectable, type CallHandler, type HttpContext, type Interceptor } from 'viga';

@Injectable()
export class DatabaseErrorsInterceptor implements Interceptor {
  async intercept(_ctx: HttpContext, next: CallHandler) {
    try {
      return await next();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException();
      throw error;
    }
  }
}
```

`isUniqueViolation` is a function of yours that recognizes your database's duplicate key error. That way, a duplicate record responds 409 instead of 500, without a `try/catch` in every service. Rethrow the errors you don't recognize so viga handles them as usual.

viga's exceptions, like `NotFoundException`, also go through the interceptors. An interceptor that transforms the response, like `EnvelopeInterceptor`, leaves them alone: since `await next()` throws, the `return { data: ... }` never runs.

## The order they run in

For each request, viga first runs every guard and then the interceptors, from the outside in:

1. The global interceptors.
2. Those in `@UseInterceptors()` on the class.
3. Those in `@UseInterceptors()` on the method.
4. The `@Validate` validation and the controller method.

On the way back they follow the reverse path: the method's interceptor gets the result first and the global one last. Among several at the same level, the first in the list is the outermost.

If a guard rejects the request, no interceptor runs.

:::note
Interceptors run before `@Validate`, so `ctx.body`, `ctx.params` and `ctx.query` still hold the data unvalidated and unconverted. If an interceptor needs to read them, treat them as data coming from the client. The controller method does receive the validated data.
:::

## Guards or interceptors

Both tools run around a route, but they answer different questions:

- **A guard** decides whether the request can continue. It returns `true` or `false` and doesn't see the response.
- **An interceptor** wraps the execution. It sees the result and the error, and can change them.

Checking permissions goes in a guard. Measuring, logging, transforming or caching goes in an interceptor.
