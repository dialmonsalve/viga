---
title: viga/pagination
description: Pagine listagens com ?page e ?limit, com resultados tipados, links para a página seguinte e anterior, e limites que protegem o banco de dados.
sidebar:
  order: 4
---

`viga/pagination` lê os parâmetros `?page` e `?limit` da URL, os valida e dá ao seu método o que ele precisa para consultar uma página: o número da página, o tamanho e o deslocamento. Depois monta a resposta com os dados, o total e os links para a página seguinte e anterior.

Ele não consulta o banco de dados por você. Funciona com qualquer ORM ou com SQL direto: você faz a consulta com os números que ele dá.

## Pagine uma listagem

Adicione `@Paginate()` à rota e use `PageContext` como tipo do contexto:

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

`page` tem três valores para a sua consulta:

| Valor | O que é | Com `?page=3&limit=20` |
| --- | --- | --- |
| `page.page` | A página pedida. | `3` |
| `page.limit` | Quantos itens por página. | `20` |
| `page.offset` | Quantos itens pular. | `40` |

Se a requisição não trouxer `?page`, é usada a página 1. Se não trouxer `?limit`, são usados 20 itens.

### A consulta

O serviço usa `offset` e `limit` na consulta, e conta o total separadamente. Com `pg`:

```ts title="src/books/books.service.ts"
async findPage(offset: number, limit: number) {
  const [rows, count] = await Promise.all([
    this.pool.query('SELECT id, title FROM books ORDER BY id LIMIT $1 OFFSET $2', [limit, offset]),
    this.pool.query('SELECT count(*)::int AS total FROM books'),
  ]);
  return [rows.rows, count.rows[0].total] as const;
}
```

O `ORDER BY` é importante: sem uma ordem fixa, o banco de dados pode devolver as linhas em outra ordem a cada consulta, e um mesmo livro poderia aparecer em duas páginas ou em nenhuma.

## A resposta

`page.result(items, total)` monta a resposta:

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

| Campo | O que contém |
| --- | --- |
| `data` | Os itens desta página. |
| `meta.total` | Quantos itens há no total. |
| `meta.page` | A página atual. |
| `meta.lastPage` | A última página com itens. |
| `meta.next` | O link para a página seguinte, ou `null` na última. |
| `meta.prev` | O link para a página anterior, ou `null` na primeira. |

Os links mantêm os outros parâmetros da URL, como `status=open`, então o frontend só precisa segui-los.

Se alguém pedir uma página posterior à última, recebe `data` vazio e um `prev` que aponta para a última página, para poder voltar.

### O tipo da resposta

`page.result()` é genérico: se você passar `Book[]`, o método devolve `PaginatedResult<Book>`. Você pode exportar esse tipo para compartilhá-lo com o seu frontend:

```ts
import type { PaginatedResult } from 'viga/pagination';

export type BooksPage = PaginatedResult<Book>;
```

## Filtros e busca

Para combinar a paginação com outros parâmetros da URL, como um filtro, valide-os com [`@Validate`](../validation/) e passe o schema para `PageContext`:

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

`page` e `limit` também chegam em `query`, então o schema precisa aceitá-los. Um `z.object()` normal os aceita e descarta. Um `z.strictObject()` os rejeita e a requisição responde 400; se você o usar, declare `page` e `limit` no schema.

## Limites

Sem limites, um cliente poderia pedir `?limit=1000000` e fazer o banco de dados devolver uma tabela inteira, ou pedir `?page=500000` e forçar uma consulta lentíssima: um `OFFSET` enorme é lento mesmo quando não devolve nada. `@Paginate` define tetos por padrão, que você pode ajustar:

```ts
@Paginate({ defaultLimit: 20, maxLimit: 100, maxPage: 1000, maxOffset: 10_000 })
```

| Opção | Padrão | O que faz |
| --- | --- | --- |
| `defaultLimit` | `20` | O tamanho da página se a requisição não trouxer `?limit`. |
| `maxLimit` | `100` | O tamanho máximo. Um `?limit` maior é reduzido a esse valor, não rejeitado. |
| `maxPage` | `1000` | A página mais alta que pode ser pedida. |
| `maxOffset` | `10000` | Quantos itens podem ser pulados no máximo. |

A página mais alta permitida depende de `maxPage`, `maxOffset` e do `limit`: com `limit=100`, `maxOffset` permite chegar até a página 101. Se uma listagem precisa ir mais longe, a paginação com `OFFSET` não é a ferramenta adequada: use paginação por cursor, com consultas como `WHERE id > :ultimoId`.

## Erros

| Requisição | Resposta |
| --- | --- |
| `?page` não é um inteiro, é menor que 1, ultrapassa o máximo ou vem repetido | 400 com o código `errors.invalidPage` |
| `?limit` não é um inteiro positivo | 400 com o código `errors.invalidLimit` |

A mensagem de `errors.invalidPage` diz qual é a página mais alta permitida:

```json
{ "statusCode": 400, "code": "errors.invalidPage", "message": "page must be an integer between 1 and 101", "error": "Bad Request" }
```

## Os links são relativos

`next` e `prev` são caminhos relativos, como `/api/books?page=3&limit=20`, sem domínio. O viga nunca os constrói com o cabeçalho `Host` da requisição, que o cliente pode falsificar. Assim, ninguém consegue fazer sua API devolver links que apontem para outro domínio.
