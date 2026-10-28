---
title: Controllers
description: Como as rotas são definidas, o que cada método recebe, como o viga monta a resposta e quais códigos de status usa.
sidebar:
  order: 3
---

Um controller recebe as requisições HTTP de uma funcionalidade e devolve a resposta. Ele não contém lógica de negócio: pede-a aos providers, como você viu na [primeira aplicação](../../start/first-app/).

## Defina as rotas

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

- `@Controller('/books')` define o prefixo de todas as rotas do controller.
- `@Get()`, `@Post()`, `@Put()`, `@Patch()` e `@Delete()` transformam um método em uma rota. O caminho que recebem é somado ao prefixo: `@Get('/:id')` responde a `GET /books/:id`.
- Se a aplicação tem `globalPrefix: '/api'`, todas as rotas começam com `/api`: `GET /api/books/:id`.
- `@Public()` sobre a classe abre todas as suas rotas. Isso é explicado no final da página.

:::caution[A ordem das rotas importa]
O viga registra as rotas na ordem em que aparecem na classe, e uma requisição vai para a primeira que corresponder. Se `@Get('/:id')` estiver antes de `@Get('/export')`, a requisição `GET /books/export` chega a `findOne` com `params.id` igual a `'export'`. Declare as rotas fixas antes das que têm parâmetros.
:::

O controller é registrado em `controllers` do seu módulo. O viga o cria uma única vez ao iniciar, e ele pode pedir providers com `inject()` como qualquer outra classe. Diferente de um provider, um controller não é exportado nem injetado em outras classes.

## O que cada método recebe

Cada método recebe o contexto da requisição, um objeto com estas propriedades:

| Propriedade | O que contém |
| --- | --- |
| `params` | Os parâmetros da rota. Em `/books/:id`, `params.id`. |
| `query` | Os parâmetros da URL. Em `/books?page=2`, `query.page`. |
| `body` | O corpo da requisição, já lido. |
| `req` | A requisição do Express, para o que o contexto não traz, como os cabeçalhos. |
| `res` | A resposta do Express, para responder você mesmo. |

O habitual é desestruturar só o que você usa: `findOne({ params }: HttpContext)`. Se o método não precisa de nada, não declare o parâmetro, como em `list()`.

`params` e `query` chegam como texto: em `GET /books/7`, `params.id` é `'7'`, não `7`. Por isso o exemplo usa `Number(params.id)`.

## Valide o que chega

`Number('abc')` é `NaN`, e nada impede alguém de pedir `/books/abc`. A forma de garantir que os dados estão corretos, e de tê-los com o tipo adequado, é validá-los com `@Validate`, de `viga/validation`, e um schema de uma biblioteca como Zod ou Valibot:

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

Agora `params.id` é um número e `body` tem o tipo `{ title: string }`. Se os dados não cumprirem o schema, o viga responde 400 sem chamar o método. A validação tem sua própria página, com o formato dos erros.

:::note
Uma rota sem `@Validate({ body })` não aceita corpo. Se alguém enviar um, o viga responde 400 com o código `errors.unexpectedBody`. Assim nenhum dado sem validar chega ao seu código por descuido.
:::

## A resposta

O que o método devolve é enviado como JSON. Se ele devolver uma promise, o viga espera que ela se resolva. O código de status depende do método HTTP e do que você devolver:

| Caso | Código |
| --- | --- |
| O método devolve um valor | `200`, ou `201` nas rotas `@Post()` |
| O método não devolve nada (`undefined`) | `204`, sem corpo |

Por isso `remove()` responde 204: não devolve nada.

Para usar outro código, adicione `@HttpCode()`:

```ts
@Post('/:id/publish')
@HttpCode(202)
publish({ params }: HttpContext) {
  return this.books.publish(Number(params.id));
}
```

### Erros

Para responder com um erro, lance uma das exceções do viga:

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

O viga a converte em uma resposta 404 com um corpo de erro em JSON. As exceções disponíveis e o formato do corpo estão na página de exceções.

### Responda você mesmo

Se você precisa de algo que não é JSON, como um CSV ou um arquivo, use `res` e não devolva nada:

```ts
@Get('/export')
exportCsv({ res }: HttpContext) {
  res.type('text/csv').send(this.books.toCsv());
}
```

Quando a resposta já foi enviada, o viga não tenta enviar outra.

## Rotas privadas por padrão

No viga todas as rotas são privadas: sem um guard de autenticação configurado, respondem 401. `@Public()` abre uma rota específica se você o colocar sobre o método, ou todas as do controller se o colocar sobre a classe:

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

Aqui qualquer pessoa pode listar os livros, mas criar um exige estar autenticado. Como configurar a autenticação você verá na página de guards.
