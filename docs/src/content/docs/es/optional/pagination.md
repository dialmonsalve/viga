---
title: viga/pagination
description: Pagina listados con ?page y ?limit, con resultados tipados, enlaces a la página siguiente y anterior, y límites que protegen la base de datos.
sidebar:
  order: 4
---

`viga/pagination` lee los parámetros `?page` y `?limit` de la URL, los valida y le da a tu método lo que necesita para consultar una página: el número de página, el tamaño y el desplazamiento. Después arma la respuesta con los datos, el total y los enlaces a la página siguiente y anterior.

No consulta la base de datos por ti. Funciona con cualquier ORM o con SQL directo: tú haces la consulta con los números que te da.

## Pagina un listado

Añade `@Paginate()` a la ruta y usa `PageContext` como tipo del contexto:

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

`page` tiene tres valores para tu consulta:

| Valor | Qué es | Con `?page=3&limit=20` |
| --- | --- | --- |
| `page.page` | La página pedida. | `3` |
| `page.limit` | Cuántos elementos por página. | `20` |
| `page.offset` | Cuántos elementos saltar. | `40` |

Si la petición no trae `?page`, se usa la página 1. Si no trae `?limit`, se usan 20 elementos.

### La consulta

El servicio usa `offset` y `limit` en la consulta, y cuenta el total por separado. Con `pg`:

```ts title="src/books/books.service.ts"
async findPage(offset: number, limit: number) {
  const [rows, count] = await Promise.all([
    this.pool.query('SELECT id, title FROM books ORDER BY id LIMIT $1 OFFSET $2', [limit, offset]),
    this.pool.query('SELECT count(*)::int AS total FROM books'),
  ]);
  return [rows.rows, count.rows[0].total] as const;
}
```

El `ORDER BY` es importante: sin un orden fijo, la base de datos puede devolver las filas en otro orden en cada consulta, y un mismo libro podría aparecer en dos páginas o en ninguna.

## La respuesta

`page.result(items, total)` arma la respuesta:

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

| Campo | Qué contiene |
| --- | --- |
| `data` | Los elementos de esta página. |
| `meta.total` | Cuántos elementos hay en total. |
| `meta.page` | La página actual. |
| `meta.lastPage` | La última página con elementos. |
| `meta.next` | El enlace a la página siguiente, o `null` en la última. |
| `meta.prev` | El enlace a la página anterior, o `null` en la primera. |

Los enlaces conservan los demás parámetros de la URL, como `status=open`, así que el frontend solo tiene que seguirlos.

Si alguien pide una página posterior a la última, recibe `data` vacío y un `prev` que apunta a la última página, para que pueda volver.

### El tipo de la respuesta

`page.result()` es genérico: si le pasas `Book[]`, el método devuelve `PaginatedResult<Book>`. Puedes exportar ese tipo para compartirlo con tu frontend:

```ts
import type { PaginatedResult } from 'viga/pagination';

export type BooksPage = PaginatedResult<Book>;
```

## Filtros y búsqueda

Para combinar la paginación con otros parámetros de la URL, como un filtro, valídalos con [`@Validate`](../validation/) y pásale el esquema a `PageContext`:

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

`page` y `limit` también llegan en `query`, así que el esquema tiene que aceptarlos. Un `z.object()` normal los acepta y los descarta. Un `z.strictObject()` los rechaza y la petición responde 400; si lo usas, declara `page` y `limit` en el esquema.

## Límites

Sin límites, un cliente podría pedir `?limit=1000000` y hacer que la base de datos devuelva una tabla entera, o pedir `?page=500000` y forzar una consulta lentísima: un `OFFSET` enorme es lento aunque no devuelva nada. `@Paginate` pone topes por defecto, que puedes ajustar:

```ts
@Paginate({ defaultLimit: 20, maxLimit: 100, maxPage: 1000, maxOffset: 10_000 })
```

| Opción | Por defecto | Qué hace |
| --- | --- | --- |
| `defaultLimit` | `20` | El tamaño de página si la petición no trae `?limit`. |
| `maxLimit` | `100` | El tamaño máximo. Un `?limit` mayor se reduce a este valor, no se rechaza. |
| `maxPage` | `1000` | La página más alta que se puede pedir. |
| `maxOffset` | `10000` | Cuántos elementos se pueden saltar como máximo. |

La página más alta permitida depende de `maxPage`, `maxOffset` y el `limit`: con `limit=100`, `maxOffset` deja llegar hasta la página 101. Si un listado necesita llegar más lejos, la paginación con `OFFSET` no es la herramienta adecuada: usa paginación por cursor, con consultas como `WHERE id > :ultimoId`.

## Errores

| Petición | Respuesta |
| --- | --- |
| `?page` no es un entero, es menor que 1, supera el máximo o viene repetido | 400 con el código `errors.invalidPage` |
| `?limit` no es un entero positivo | 400 con el código `errors.invalidLimit` |

El mensaje de `errors.invalidPage` dice cuál es la página más alta permitida:

```json
{ "statusCode": 400, "code": "errors.invalidPage", "message": "page must be an integer between 1 and 101", "error": "Bad Request" }
```

## Los enlaces son relativos

`next` y `prev` son rutas relativas, como `/api/books?page=3&limit=20`, sin dominio. viga nunca los construye con la cabecera `Host` de la petición, que el cliente puede falsificar. Así, nadie puede hacer que tu API devuelva enlaces que apunten a otro dominio.
