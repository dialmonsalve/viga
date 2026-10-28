---
title: Controladores
description: Cómo se definen las rutas, qué recibe cada método, cómo viga arma la respuesta y qué códigos de estado usa.
sidebar:
  order: 3
---

Un controlador recibe las peticiones HTTP de una funcionalidad y devuelve la respuesta. No contiene lógica de negocio: se la pide a los providers, como viste en la [primera app](../../start/first-app/).

## Define las rutas

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

- `@Controller('/books')` define el prefijo de todas las rutas del controlador.
- `@Get()`, `@Post()`, `@Put()`, `@Patch()` y `@Delete()` convierten un método en una ruta. La ruta que reciben se suma al prefijo: `@Get('/:id')` responde a `GET /books/:id`.
- Si la app tiene `globalPrefix: '/api'`, todas las rutas empiezan por `/api`: `GET /api/books/:id`.
- `@Public()` sobre la clase abre todas sus rutas. Lo explicamos al final de la página.

:::caution[El orden de las rutas importa]
viga registra las rutas en el orden en que aparecen en la clase, y una petición va a la primera que coincide. Si `@Get('/:id')` está antes que `@Get('/export')`, la petición `GET /books/export` llega a `findOne` con `params.id` igual a `'export'`. Declara las rutas fijas antes que las que tienen parámetros.
:::

El controlador se registra en `controllers` de su módulo. viga lo crea una sola vez al arrancar, y puede pedir providers con `inject()` igual que cualquier otra clase. A diferencia de un provider, un controlador no se exporta ni se inyecta en otras clases.

## Lo que recibe cada método

Cada método recibe el contexto de la petición, un objeto con estas propiedades:

| Propiedad | Qué contiene |
| --- | --- |
| `params` | Los parámetros de la ruta. En `/books/:id`, `params.id`. |
| `query` | Los parámetros de la URL. En `/books?page=2`, `query.page`. |
| `body` | El cuerpo de la petición, ya leído. |
| `req` | La petición de Express, para lo que el contexto no trae, como las cabeceras. |
| `res` | La respuesta de Express, para responder tú mismo. |

Lo habitual es desestructurar solo lo que usas: `findOne({ params }: HttpContext)`. Si el método no necesita nada, no declares el parámetro, como en `list()`.

`params` y `query` llegan como texto: en `GET /books/7`, `params.id` es `'7'`, no `7`. Por eso el ejemplo usa `Number(params.id)`.

## Valida lo que llega

`Number('abc')` es `NaN`, y nada impide que alguien pida `/books/abc`. La forma de asegurarte de que los datos son correctos, y de tenerlos con el tipo adecuado, es validarlos con `@Validate`, de `viga/validation`, y un esquema de una librería como Zod o Valibot:

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

Ahora `params.id` es un número y `body` tiene el tipo `{ title: string }`. Si los datos no cumplen el esquema, viga responde 400 sin llamar al método. La validación tiene su propia página, con el formato de los errores.

:::note
Una ruta sin `@Validate({ body })` no acepta cuerpo. Si alguien envía uno, viga responde 400 con el código `errors.unexpectedBody`. Así ningún dato sin validar llega a tu código por descuido.
:::

## La respuesta

Lo que devuelve el método se envía como JSON. Si devuelve una promesa, viga espera a que se resuelva. El código de estado depende del método HTTP y de lo que devuelvas:

| Caso | Código |
| --- | --- |
| El método devuelve un valor | `200`, o `201` en las rutas `@Post()` |
| El método no devuelve nada (`undefined`) | `204`, sin cuerpo |

Por eso `remove()` responde 204: no devuelve nada.

Para usar otro código, añade `@HttpCode()`:

```ts
@Post('/:id/publish')
@HttpCode(202)
publish({ params }: HttpContext) {
  return this.books.publish(Number(params.id));
}
```

### Errores

Para responder con un error, lanza una de las excepciones de viga:

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

viga la convierte en una respuesta 404 con un cuerpo de error en JSON. Las excepciones disponibles y el formato del cuerpo están en la página de excepciones.

### Responder tú mismo

Si necesitas algo que no es JSON, como un CSV o un archivo, usa `res` y no devuelvas nada:

```ts
@Get('/export')
exportCsv({ res }: HttpContext) {
  res.type('text/csv').send(this.books.toCsv());
}
```

Cuando la respuesta ya se envió, viga no intenta enviar otra.

## Rutas privadas por defecto

En viga todas las rutas son privadas: sin un guard de autenticación configurado, responden 401. `@Public()` abre una ruta concreta si lo pones sobre el método, o todas las del controlador si lo pones sobre la clase:

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

Aquí cualquiera puede listar los libros, pero crear uno exige estar autenticado. Cómo se configura la autenticación lo verás en la página de guards.
