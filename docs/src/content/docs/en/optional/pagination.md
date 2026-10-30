---
title: viga/pagination
description: Paginate lists with ?page and ?limit, with typed results, links to the next and previous page, and limits that protect the database.
sidebar:
  order: 4
---

`viga/pagination` reads the `?page` and `?limit` URL parameters, validates them and gives your method what it needs to query a page: the page number, the size and the offset. Then it builds the response with the data, the total and the links to the next and previous page.

It doesn't query the database for you. It works with any ORM or with plain SQL: you run the query with the numbers it gives you.

## Paginate a list

Add `@Paginate()` to the route and use `PageContext` as the context type:

```ts title="src/books/books.controller.ts"
import { Controller, Get } from 'viga';
import { Paginate, type PageContext } from 'viga/pagination';

@Controller('/books')
export class BooksController {
  @Get()
  @Paginate()
  async list({ page }: PageContext) {
    const [books, total] = await this.books.findPage(page.offset, page.limit);
    return page.result(books, total);
  }
}
```

`page` has three values for your query:

| Value | What it is | With `?page=3&limit=20` |
| --- | --- | --- |
| `page.page` | The requested page. | `3` |
| `page.limit` | How many items per page. | `20` |
| `page.offset` | How many items to skip. | `40` |

If the request has no `?page`, page 1 is used. If it has no `?limit`, 20 items are used.

### The query

The service uses `offset` and `limit` in the query, and counts the total separately. With `pg`:

```ts title="src/books/books.service.ts"
async findPage(offset: number, limit: number) {
  const [rows, count] = await Promise.all([
    this.pool.query('SELECT id, title FROM books ORDER BY id LIMIT $1 OFFSET $2', [limit, offset]),
    this.pool.query('SELECT count(*)::int AS total FROM books'),
  ]);
  return [rows.rows, count.rows[0].total] as const;
}
```

The `ORDER BY` matters: without a fixed order, the database may return the rows in a different order on each query, and the same book could show up on two pages or on none.

## The response

`page.result(items, total)` builds the response:

```json
{
  "data": [{ "id": 21, "title": "Dune" }],
  "meta": {
    "total": 95,
    "page": 2,
    "lastPage": 5,
    "next": "/api/books?status=open&page=3&limit=20",
    "prev": "/api/books?status=open&page=1&limit=20"
  }
}
```

| Field | What it holds |
| --- | --- |
| `data` | The items on this page. |
| `meta.total` | How many items there are in total. |
| `meta.page` | The current page. |
| `meta.lastPage` | The last page with items. |
| `meta.next` | The link to the next page, or `null` on the last one. |
| `meta.prev` | The link to the previous page, or `null` on the first one. |

The links keep the other URL parameters, like `status=open`, so the frontend only has to follow them.

If someone asks for a page after the last one, they get an empty `data` and a `prev` pointing to the last page, so they can go back.

### The response type

`page.result()` is generic: if you pass it `Book[]`, the method returns `PaginatedResult<Book>`. You can export that type to share it with your frontend:

```ts
import type { PaginatedResult } from 'viga/pagination';

export type BooksPage = PaginatedResult<Book>;
```

## Filters and search

To combine pagination with other URL parameters, like a filter, validate them with [`@Validate`](../validation/) and pass the schema to `PageContext`:

```ts
import { z } from 'zod';

const BookFilter = z.object({ status: z.enum(['open', 'closed']).optional() });

@Get()
@Paginate()
@Validate({ query: BookFilter })
async list({ page, query }: PageContext<{ query: typeof BookFilter }>) {
  const [books, total] = await this.books.findPage(query, page.offset, page.limit);
  return page.result(books, total);
}
```

`page` and `limit` also arrive in `query`, so the schema has to accept them. A regular `z.object()` accepts and drops them. A `z.strictObject()` rejects them and the request responds 400; if you use it, declare `page` and `limit` in the schema.

## Limits

Without limits, a client could ask for `?limit=1000000` and make the database return a whole table, or ask for `?page=500000` and force a very slow query: a huge `OFFSET` is slow even when it returns nothing. `@Paginate` sets caps by default, which you can adjust:

```ts
@Paginate({ defaultLimit: 20, maxLimit: 100, maxPage: 1000, maxOffset: 10_000 })
```

| Option | Default | What it does |
| --- | --- | --- |
| `defaultLimit` | `20` | The page size if the request has no `?limit`. |
| `maxLimit` | `100` | The maximum size. A larger `?limit` is reduced to this value, not rejected. |
| `maxPage` | `1000` | The highest page that can be requested. |
| `maxOffset` | `10000` | How many items can be skipped at most. |

The highest allowed page depends on `maxPage`, `maxOffset` and the `limit`: with `limit=100`, `maxOffset` lets you reach page 101. If a list needs to go further, `OFFSET` pagination isn't the right tool: use cursor pagination, with queries like `WHERE id > :lastId`.

## Errors

| Request | Response |
| --- | --- |
| `?page` isn't an integer, is below 1, exceeds the maximum or is repeated | 400 with the code `errors.invalidPage` |
| `?limit` isn't a positive integer | 400 with the code `errors.invalidLimit` |

The `errors.invalidPage` message says which is the highest allowed page:

```json
{ "statusCode": 400, "code": "errors.invalidPage", "message": "page must be an integer between 1 and 101", "error": "Bad Request" }
```

## The links are relative

`next` and `prev` are relative paths, like `/api/books?page=3&limit=20`, with no domain. viga never builds them from the request's `Host` header, which the client can forge. That way, nobody can make your API return links that point to another domain.
