---
title: Controllers
description: How routes are defined, what each method receives, how viga builds the response and which status codes it uses.
sidebar:
  order: 3
---

A controller receives the HTTP requests of one feature and returns the response. It holds no business logic: it asks the providers for it, as you saw in the [first app](../../start/first-app/).

## Define the routes

```ts title="src/books/books.controller.ts"
import { Controller, Delete, Get, Post, Public, inject, type HttpContext } from 'viga';
import { BooksService } from './books.service.ts';

@Public()
@Controller('/books')
export class BooksController {
  private readonly books = inject(BooksService);

  @Get()
  list() {
    return this.books.findAll();
  }

  @Get('/:id')
  findOne({ params }: HttpContext) {
    return this.books.findOne(Number(params.id));
  }

  @Delete('/:id')
  remove({ params }: HttpContext) {
    this.books.remove(Number(params.id));
  }
}
```

- `@Controller('/books')` sets the prefix of every route in the controller.
- `@Get()`, `@Post()`, `@Put()`, `@Patch()` and `@Delete()` turn a method into a route. The path they receive is added to the prefix: `@Get('/:id')` answers `GET /books/:id`.
- If the app has `globalPrefix: '/api'`, every route starts with `/api`: `GET /api/books/:id`.
- `@Public()` on the class opens all its routes. It is explained at the end of the page.

:::caution[Route order matters]
viga registers routes in the order they appear in the class, and a request goes to the first one that matches. If `@Get('/:id')` comes before `@Get('/export')`, the request `GET /books/export` reaches `findOne` with `params.id` set to `'export'`. Declare fixed routes before the ones with parameters.
:::

The controller is registered in the `controllers` of its module. viga creates it only once at startup, and it can ask for providers with `inject()` like any other class. Unlike a provider, a controller is neither exported nor injected into other classes.

## What each method receives

Each method receives the request context, an object with these properties:

| Property | What it holds |
| --- | --- |
| `params` | The route parameters. In `/books/:id`, `params.id`. |
| `query` | The URL query parameters. In `/books?page=2`, `query.page`. |
| `body` | The request body, already read. |
| `req` | The Express request, for whatever the context doesn't carry, like headers. |
| `res` | The Express response, to respond yourself. |

The usual thing is to destructure only what you use: `findOne({ params }: HttpContext)`. If the method needs nothing, don't declare the parameter, as in `list()`.

`params` and `query` arrive as text: in `GET /books/7`, `params.id` is `'7'`, not `7`. That is why the example uses `Number(params.id)`.

## Validate what comes in

`Number('abc')` is `NaN`, and nothing stops someone from requesting `/books/abc`. The way to make sure the data is correct, and to get it with the right type, is to validate it with `@Validate`, from `viga/validation`, and a schema from a library like Zod or Valibot:

```ts title="src/books/books.controller.ts"
import { Validate } from 'viga/validation';
import { z } from 'zod';

const BookParams = z.object({ id: z.coerce.number().int().positive() });
const CreateBook = z.object({ title: z.string().min(1) });
```

```ts title="src/books/books.controller.ts"
@Get('/:id')
@Validate({ params: BookParams })
findOne({ params }: HttpContext<{ params: typeof BookParams }>) {
  return this.books.findOne(params.id);
}

@Post()
@Validate({ body: CreateBook })
create({ body }: HttpContext<{ body: typeof CreateBook }>) {
  return this.books.create(body);
}
```

Now `params.id` is a number and `body` has the type `{ title: string }`. If the data doesn't match the schema, viga responds 400 without calling the method. Validation has its own page, with the error format.

:::note
A route without `@Validate({ body })` doesn't accept a body. If someone sends one, viga responds 400 with the code `errors.unexpectedBody`. That way no unvalidated data reaches your code by accident.
:::

## The response

Whatever the method returns is sent as JSON. If it returns a promise, viga waits for it to resolve. The status code depends on the HTTP method and on what you return:

| Case | Code |
| --- | --- |
| The method returns a value | `200`, or `201` on `@Post()` routes |
| The method returns nothing (`undefined`) | `204`, with no body |

That is why `remove()` responds 204: it returns nothing.

To use another code, add `@HttpCode()`:

```ts
@Post('/:id/publish')
@HttpCode(202)
publish({ params }: HttpContext) {
  return this.books.publish(Number(params.id));
}
```

### Errors

To respond with an error, throw one of viga's exceptions:

```ts
import { NotFoundException } from 'viga';

@Get('/:id')
@Validate({ params: BookParams })
findOne({ params }: HttpContext<{ params: typeof BookParams }>) {
  const book = this.books.findOne(params.id);
  if (!book) throw new NotFoundException();
  return book;
}
```

viga turns it into a 404 response with a JSON error body. The available exceptions and the body format are on the exceptions page.

### Respond yourself

If you need something that isn't JSON, like a CSV or a file, use `res` and return nothing:

```ts
@Get('/export')
exportCsv({ res }: HttpContext) {
  res.type('text/csv').send(this.books.toCsv());
}
```

Once the response has been sent, viga doesn't try to send another one.

## Private routes by default

In viga every route is private: without an authentication guard configured, they respond 401. `@Public()` opens a single route if you put it on the method, or every route of the controller if you put it on the class:

```ts
@Controller('/books')
export class BooksController {
  private readonly books = inject(BooksService);

  @Public()
  @Get()
  list() {
    return this.books.findAll();
  }

  @Post()
  @Validate({ body: CreateBook })
  create({ body }: HttpContext<{ body: typeof CreateBook }>) {
    return this.books.create(body);
  }
}
```

Here anyone can list the books, but creating one requires being authenticated. How to set up authentication is covered on the guards page.
