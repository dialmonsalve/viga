---
title: Primera app
description: Crea una API con un módulo, un controlador y un servicio, y arráncala paso a paso.
sidebar:
  order: 3
---

En esta guía construyes una API pequeña que lista libros. Sirve para ver las tres piezas con las que se arma cualquier app de viga: servicios, controladores y módulos. Antes, sigue los pasos de la instalación.

## Estructura del proyecto

Al terminar, el proyecto tendrá estos archivos:

```txt
src/
  books/
    books.service.ts
    books.controller.ts
    books.module.ts
  app.module.ts
  main.ts
```

Cada funcionalidad vive en su propia carpeta con su módulo. `app.module.ts` las reúne y `main.ts` arranca la app.

## El servicio

Un servicio contiene la lógica de la app. Aquí devuelve una lista fija de libros. En una app real consultaría la base de datos.

```ts title="src/books/books.service.ts"
import { Injectable } from 'viga';

export interface Book {
  id: number;
  title: string;
}

@Injectable()
export class BooksService {
  private readonly books: Book[] = [
    { id: 1, title: 'Dune' },
    { id: 2, title: 'Fundación' },
  ];

  findAll() {
    return this.books;
  }
}
```

`@Injectable()` permite que viga cree el servicio y lo entregue a quien lo pida.

## El controlador

Un controlador recibe las peticiones HTTP y responde. No contiene lógica: se la pide al servicio.

```ts title="src/books/books.controller.ts"
import { Controller, Get, Public, inject } from 'viga';
import { BooksService } from './books.service.ts';

@Controller('/books')
export class BooksController {
  private readonly books = inject(BooksService);

  @Public()
  @Get()
  list() {
    return this.books.findAll();
  }
}
```

- `@Controller('/books')` define el prefijo de todas las rutas del controlador.
- `@Get()` responde a `GET /books`. Lo que devuelve el método se envía como JSON, y si es una promesa, viga espera a que se resuelva.
- `inject(BooksService)` pide el servicio. viga lo crea una vez y lo comparte.
- `@Public()` abre la ruta. Sin él, sería privada.

## El módulo

Un módulo agrupa los controladores y servicios de una funcionalidad.

```ts title="src/books/books.module.ts"
import { Module } from 'viga';
import { BooksController } from './books.controller.ts';
import { BooksService } from './books.service.ts';

@Module({
  controllers: [BooksController],
  providers: [BooksService],
})
export class BooksModule {}
```

Los servicios van en `providers`. Solo los controladores y servicios de este módulo pueden pedirlos, salvo que el módulo los exporte.

## El módulo raíz

El módulo raíz reúne los módulos de la app:

```ts title="src/app.module.ts"
import { Module } from 'viga';
import { BooksModule } from './books/books.module.ts';

@Module({ imports: [BooksModule] })
export class AppModule {}
```

## Arranca la app

```ts title="src/main.ts"
import { createApp } from 'viga';
import { AppModule } from './app.module.ts';

const app = createApp({ rootModule: AppModule, globalPrefix: '/api' }).enableShutdownHooks();

await app.listen();
```

- `globalPrefix` antepone `/api` a todas las rutas.
- `enableShutdownHooks()` cierra la app de forma ordenada al detener el proceso, por ejemplo con `Ctrl+C`.
- `listen()` empieza a escuchar en el puerto 3000. El puerto es opcional: `listen(8080)` usa otro. viga no lee la variable de entorno `PORT` por su cuenta; si la usas, pásala tú: `app.listen(Number(process.env.PORT ?? 3000))`.

Arráncala en modo desarrollo:

```sh
pnpm dev
```

## Prueba la API

```sh
curl http://localhost:3000/api/books
```

```json
[{ "id": 1, "title": "Dune" }, { "id": 2, "title": "Fundación" }]
```

## Las rutas son privadas por defecto

Quita `@Public()` del controlador y vuelve a probar. La ruta responde 401:

```json
{
  "statusCode": 401,
  "code": "errors.unauthorized",
  "message": "You must sign in to continue",
  "error": "Unauthorized"
}
```

Además, al arrancar, la app avisa de cuántas rutas privadas no tienen forma de autenticarse:

```txt
[App] No auth guard is configured, so the 1 private routes will respond 401; add app.useAuthGuard() or mark public routes with @Public()
```

En viga, una ruta se abre a propósito, nunca por olvido. Para las rutas que requieren sesión, configuras tu propia autenticación con `app.useAuthGuard()`, como verás en la sección del núcleo.

## Opcional: separa el acceso a datos con un repositorio

La app ya funciona así. Cuando crece, conviene separar la lógica, que vive en el servicio, del acceso a los datos, que pasa a un repositorio. Así puedes cambiar de dónde salen los datos, por ejemplo de memoria a una base de datos, sin tocar el servicio, y reemplazar el repositorio en las pruebas.

Primero defines qué ofrece el repositorio, con una interfaz:

```ts title="src/books/books.repository.ts"
import { InjectionToken } from 'viga';

export interface Book {
  id: number;
  title: string;
}

export interface BooksRepository {
  findAll(): Promise<Book[]>;
}

export const BOOKS_REPOSITORY = new InjectionToken<BooksRepository>('BOOKS_REPOSITORY');
```

TypeScript borra las interfaces al compilar, así que no se pueden usar para pedir una dependencia. `BOOKS_REPOSITORY` es el token que la representa: quien lo pida recibirá algo que cumple `BooksRepository`. Es lo mismo que en NestJS se hace con `@Inject()` y un token.

Después escribes una implementación. Esta guarda los libros en memoria, y la interfaz `Book` ahora vive en el repositorio:

```ts title="src/books/in-memory-books.repository.ts"
import { Injectable } from 'viga';
import type { Book, BooksRepository } from './books.repository.ts';

@Injectable()
export class InMemoryBooksRepository implements BooksRepository {
  private readonly books: Book[] = [
    { id: 1, title: 'Dune' },
    { id: 2, title: 'Fundación' },
  ];

  async findAll() {
    return this.books;
  }
}
```

El servicio pide el repositorio por su token y no sabe qué implementación hay detrás:

```ts title="src/books/books.service.ts"
import { Injectable, inject } from 'viga';
import { BOOKS_REPOSITORY } from './books.repository.ts';

@Injectable()
export class BooksService {
  private readonly books = inject(BOOKS_REPOSITORY);

  findAll() {
    return this.books.findAll();
  }
}
```

`inject(BOOKS_REPOSITORY)` devuelve un valor con el tipo `BooksRepository`. Si llamas a un método que la interfaz no tiene, TypeScript lo marca como error.

Por último, el módulo decide qué implementación corresponde al token:

```ts title="src/books/books.module.ts"
import { Module } from 'viga';
import { BOOKS_REPOSITORY } from './books.repository.ts';
import { BooksController } from './books.controller.ts';
import { BooksService } from './books.service.ts';
import { InMemoryBooksRepository } from './in-memory-books.repository.ts';

@Module({
  controllers: [BooksController],
  providers: [BooksService, { provide: BOOKS_REPOSITORY, useClass: InMemoryBooksRepository }],
})
export class BooksModule {}
```

Para pasar a una base de datos, escribes otra implementación y solo cambias `useClass`. El controlador no cambia.

En una prueba, `createTestingApp`, de `viga/testing`, arranca la app reemplazando el repositorio sin tocar su código:

```ts title="src/books/books.test.ts"
import { createTestingApp } from 'viga/testing';
import { AppModule } from '../app.module.ts';
import { BOOKS_REPOSITORY } from './books.repository.ts';

const app = await createTestingApp(AppModule, {
  overrides: [
    { provide: BOOKS_REPOSITORY, useValue: { findAll: async () => [{ id: 9, title: 'Libro de prueba' }] } },
  ],
});

const { body } = await app.request('/books');
await app.close();
```

`body` contiene el libro de prueba: el servicio y el controlador son los reales, y solo cambió el repositorio. Puedes ejecutar este archivo con `tsx` o dentro de tu herramienta de pruebas, como `node:test`, que verás en la sección de pruebas.

## Próximos pasos

Ya tienes una app con un módulo, un controlador y un servicio. A partir de aquí puedes validar los datos que llegan, organizar más módulos y conectar una base de datos, que es lo que cubren las siguientes secciones.
