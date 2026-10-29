---
title: Request lifecycle
description: The full path of a request in viga, from the moment it arrives to the response, Express middlewares and the per-request context.
sidebar:
  order: 7
---

The previous pages explain each piece on its own. This one shows how they fit together: what happens to a request from the moment it arrives until the response goes out, and in what order.

## The path

viga processes every request in this order. If a step rejects it, the following ones don't run and viga responds with that step's error:

| Step | What it does | If it rejects |
| --- | --- | --- |
| 1. Request id | Assigns an id and adds it to the `X-Request-Id` header. | |
| 2. Security headers | Adds the security headers to the response. | |
| 3. Express middlewares | Runs the ones you added with `app.use()`. | Whatever each middleware decides |
| 4. CSRF check | Rejects forms sent from another site. | 403 |
| 5. Authentication | Runs the [authentication guard](../guards/#the-authentication-guard), except on `@Public()` routes. | 401 |
| 6. Body parsing | Reads the request body. | 400 if the JSON is malformed or the route doesn't accept a body, 413 if it's too large |
| 7. Route guards | Runs the `@UseGuards()` of the class and then those of the method. | 403, or 429 with `@RateLimit` |
| 8. Interceptors | Enters the [interceptors](../interceptors/): global, class and method ones. | |
| 9. Validation | Validates the data with `@Validate`. | 400 |
| 10. Method | Runs the controller method. | Whatever error it throws |

Then the result goes back through the interceptors in reverse order and viga sends the response, as explained in [controllers](../controllers/#the-response). If anything throws at any step, viga turns it into an error response with the format from [exceptions](../exceptions/).

If the route doesn't exist, the request doesn't get past step 4: it responds 404, or 401 if the app has authentication and the request carries no session.

### Why the body is read after authentication

Reading the body costs memory and time. Since it's read after step 5, an anonymous request to a private route gets 401 without the server ever reading it, and a route that doesn't exist never reads it. That way, an unauthenticated client can't make the server work by sending large bodies to private routes.

Route guards do see the body, because they run afterwards. That makes it possible, for example, to limit login attempts by email.

### The order doesn't depend on how you write the decorators

A method's decorators follow the table's order even if you write them in another one:

```ts
@Post()
@Validate({ body: CreateBook })
@UseGuards(AdminGuard)
create({ body }: HttpContext<{ body: typeof CreateBook }>) {
  return this.books.create(body);
}
```

Here `AdminGuard` runs before validation, even though it's written below it. A user without permission gets 403 before their body is validated, so they can't use the validation messages to find out what the route expects. Among several decorators of the same kind, the topmost runs first.

## Express middlewares

viga runs on Express, so you can use any Express middleware with `app.use()`, before `listen()`:

```ts title="src/main.ts"
import cors from 'cors';
import { createApp } from 'viga';
import { AppModule } from './app.module.ts';

const app = createApp({ rootModule: AppModule, globalPrefix: '/api' }).enableShutdownHooks();

app.use(cors({ origin: 'https://my-frontend.com', credentials: true }));

await app.listen();
```

Middlewares run at step 3, for every request, including those to routes that don't exist. That has two consequences:

- **There is no body yet.** `req.body` is `undefined` in a middleware, because the body is read at step 6.
- **There is no authentication yet.** Don't use a middleware to decide permissions: that's what guards are for.

Since they run after the security headers, a middleware can change them if you need to.

## The request context

In [guards](../guards/#share-the-user-with-the-rest-of-the-code) you used `CURRENT_USER` so any code can know the user without receiving it as a parameter. `CURRENT_USER` is a context key, created with `createContextKey`:

```ts title="src/auth/current-user.ts"
import { createContextKey } from 'viga';

export const CURRENT_USER = createContextKey<User>('currentUser');
```

Each request has its own context. Even if the server handles hundreds of requests at the same time, each one sees only its own values. This works with Node.js's `AsyncLocalStorage`, which follows the request through every `await`.

A key has four methods:

| Method | What it does |
| --- | --- |
| `get()` | Returns the value, or throws if there is none. |
| `find()` | Returns the value, or `undefined` if there is none. |
| `set(value)` | Stores the value for the rest of the request. Works in middlewares, guards, interceptors, controllers and services. |
| `run(value, fn)` | Runs `fn` with that value and, when it finishes, restores the previous one. |

A common case is recording who creates or changes something, without the controller having to pass the user to the service:

```ts title="src/books/books.service.ts"
import { Injectable } from 'viga';
import { CURRENT_USER } from '../auth/current-user.ts';

@Injectable()
export class BooksService {
  create(data: NewBook) {
    const { id } = CURRENT_USER.get();
    return this.repository.insert({ ...data, createdBy: id, updatedBy: id });
  }
}
```

### The request id

viga stores each request's id in `REQUEST_ID`, a context key it ships with. Use it to tie your logs to a specific request:

```ts
import { REQUEST_ID } from 'viga';

this.logger.info('Book created', { requestId: REQUEST_ID.get(), bookId: book.id });
```

It's the same id as the `X-Request-Id` header and the `requestId` field of error responses. It's configured with the `requestId` option of `createApp`:

| Option | Default | What it does |
| --- | --- | --- |
| `header` | `'X-Request-Id'` | The header the id is sent in. |
| `trustIncoming` | `false` | Reuses the id the request carries, if it has a safe format. Turn it on only behind a proxy that generates that id, because otherwise any client can pick its own. |
| `generate` | `randomUUID` | The function that generates the ids. |

With `requestId: false` no id is generated.

### Outside a request

In a script, a scheduled job or a test there is no request, so there's no context either, and `set()` fails:

```txt
[Context] set("currentUser") can only be called inside a request or inside runInNewContext()
```

`runInNewContext` opens an empty context where `set()` and `get()` work:

```ts title="scripts/import-books.ts"
import { runInNewContext } from 'viga';

await runInNewContext(async () => {
  CURRENT_USER.set(systemUser);
  await booksService.importFromCsv('books.csv');
});
```

That way, the same service that uses `CURRENT_USER.get()` in requests also works from a script.
