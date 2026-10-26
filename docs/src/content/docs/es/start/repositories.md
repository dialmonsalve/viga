---
title: Repositorios
description: Separa el acceso a los datos del servicio con un repositorio y un token, y reemplázalo en las pruebas.
sidebar:
  order: 4
---

En la primera app, el servicio guarda la lista de libros. Funciona, pero cuando la app crece conviene separar la lógica, que se queda en el servicio, del acceso a los datos, que pasa a un repositorio. Así puedes cambiar de dónde salen los datos, por ejemplo de memoria a una base de datos, sin tocar el servicio, y reemplazar el repositorio en las pruebas.

Esta guía parte del proyecto de la [primera app](../first-app/).

## Define el repositorio

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

## Escribe una implementación

Esta implementación guarda los libros en memoria. La interfaz `Book` ahora vive en el repositorio:

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

## Pide el repositorio desde el servicio

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

## Elige la implementación en el módulo

El módulo decide qué implementación corresponde al token:

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

Para pasar a una base de datos, escribes otra implementación y solo cambias `useClass`. Ni el servicio ni el controlador cambian.

## Reemplázalo en las pruebas

`createTestingApp`, de `viga/testing`, arranca la app reemplazando el repositorio sin tocar su código:

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
