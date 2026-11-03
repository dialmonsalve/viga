---
title: viga/openapi
description: Generate an OpenAPI 3.1 document from your routes and decorators, for Scalar or any other tool, without writing it by hand.
head:
  - tag: title
    content: 'OpenAPI documentation in Node.js with viga/openapi'
sidebar:
  order: 13
---

`viga/openapi` generates an [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) document from what you already declare in your controllers, and serves it at `/openapi.json`. Since it comes from your decorators, it doesn't go out of date the way a handwritten file does.

It's only the document. To see it as a page and try your API, use the tool you prefer, like [Scalar](../../guides/scalar/).

## Turn it on

```ts title="src/app.module.ts"
import { Module } from 'viga';
import { OpenApiModule } from 'viga/openapi';
import { BooksModule } from './books/books.module.ts';

@Module({
  imports: [
    OpenApiModule.forRoot(
      {
        title: 'Books API',
        version: '1.0.0',
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      },
      { public: process.env.NODE_ENV !== 'production' }
    ),
    BooksModule,
  ],
})
export class AppModule {}
```

| Option | Default | What it does |
| --- | --- | --- |
| `title`, `version` | Required | The document's data. |
| `description` | No description | An introductory text. |
| `securitySchemes` | None | How private routes authenticate. If you leave it out, the document doesn't say how. |

If the options depend on other providers, `forRoot` also accepts a function, which can use `inject()` as in [`viga/health`](../health/#add-the-routes).

## Who can read it

The document reveals all your routes, so it's **private by default**: it goes through your [authentication guard](../../core/guards/#the-authentication-guard) like any other route. You open it in the second argument, along with its path:

```ts
OpenApiModule.forRoot(options, { path: '/docs.json', public: true });
```

These options go separately because viga has to know them before creating the providers. Like other routes, it carries the app's [`globalPrefix`](../../core/controllers/).

A tool that opens in the browser can't read a private document, because it doesn't send your token when asking for it. That's why the example only opens it outside production.

## What comes out on its own

Without touching your controllers, the document includes:

| In the document | Where it comes from |
| --- | --- |
| Routes, methods and prefix | The routes viga actually mounted. |
| Parameters and body | [`@Validate`](../validation/) |
| 400 response | Routes with `@Validate` or `@Upload`. |
| Who can access it and 401 response | [`@Public`](../../core/guards/#private-routes-by-default) |
| Success status code | [`@HttpCode`](../../core/controllers/). Without it, 201 on `POST` and 200 on the rest. |
| 429 response | [`@RateLimit`](../../security/rate-limiting/#per-route), on the route or its controller. |
| `multipart/form-data` body and 413 and 415 responses | [`@Upload`](../upload/) |

Each route is grouped by its controller's name: `BooksController` becomes `Books`.

:::note
A method that returns nothing responds 204, but viga can't know that before running it, so the document will say 200. Add `@HttpCode(204)` so they match.
:::

## Add detail with `@Docs`

`@Docs` is optional:

```ts title="src/books/books.controller.ts"
import { Controller, Delete, Get, HttpCode, Post, type HttpContext } from 'viga';
import { Docs } from 'viga/openapi';
import { Validate } from 'viga/validation';
import { Book, BookParams } from './books.schemas.ts';

@Controller('/books')
export class BooksController {
  @Get('/:id')
  @Docs({ summary: 'Returns a book', responses: { 200: Book, 404: 'The book does not exist' } })
  @Validate({ params: BookParams })
  findOne({ params }: HttpContext<{ params: typeof BookParams }>) {
    return { id: params.id, title: 'Dune' };
  }

  @Delete('/:id')
  @HttpCode(204)
  @Docs({ summary: 'Deletes a book', deprecated: true })
  remove() {}

  @Post('/import')
  @Docs({ hidden: true })
  import() {
    return { imported: true };
  }
}
```

| Field | What it does |
| --- | --- |
| `summary`, `description` | The route's text. |
| `tags` | How it's grouped, instead of the controller's name. |
| `responses` | The responses by status code. |
| `deprecated` | Marks the route as deprecated. |
| `hidden` | Leaves it out of the document. The route keeps working. |

Each response is a schema or, if there's no body to describe, a string. A string on an error code, like the example's `404`, uses [viga's error format](../../core/exceptions/#the-error-body).

On the controller, `@Docs` applies `tags`, `deprecated` and `hidden` to all its routes, and what you put on a method takes priority.

:::caution
`responses` only documents. It doesn't validate or filter what the route responds, so it may not match what your method returns, and a field missing from the schema is still sent.
:::

## The schemas

Schemas are converted with `~standard.jsonSchema`, a Standard Schema extension, without depending on a specific library:

| Library | What to do |
| --- | --- |
| Zod | Nothing. |
| ArkType | Nothing. |
| Valibot | Wrap the schema with `toStandardJsonSchema` from `@valibot/to-json-schema`. |

```ts
import { toStandardJsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';

export const CreateBook = toStandardJsonSchema(v.object({ title: v.string() }));
```

### What can't be converted

Some schemas have no JSON Schema equivalent, like `z.date()`, or a library may not offer the conversion. The app starts anyway: that part stays undetailed in the document, and viga warns about it in the log once:

```txt
[OpenApi] POST /books body could not be converted to JSON Schema: Date cannot be represented in JSON Schema
```

With a `transform`, the result can't be described, so viga uses what the schema accepts as input, or the other way round in a request body. It only warns if it can't do either.

## From code

`OpenApiService` returns the document, for example to save it to a file and generate a client in your continuous integration:

```ts title="src/export-openapi.ts"
import { writeFile } from 'node:fs/promises';
import { createApp } from 'viga';
import { OpenApiService } from 'viga/openapi';
import { AppModule } from './app.module.ts';

const app = await createApp({ rootModule: AppModule }).init();

await writeFile('openapi.json', JSON.stringify(app.get(OpenApiService).document(), null, 2));
await app.close();
```

`init()` creates all the providers, so this script needs the same environment variables as the app, and connects to the database if you use one.

## What it doesn't cover

- **WebSocket:** [gateways](../websocket/) don't appear, because OpenAPI describes HTTP APIs.
- **Middlewares:** routes you add with `app.use()` don't appear, because viga doesn't know them.
- **Optional Express parameters:** a route like `/by/:year{/:month}` is documented as `/by/{year}/{month}`, because OpenAPI has no optional path parameters.
