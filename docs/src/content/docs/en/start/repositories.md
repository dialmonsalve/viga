---
title: Repositories
description: Move data access out of the service with a repository and a token, and replace it in tests.
sidebar:
  order: 4
---

In the first app, the service holds the list of books. It works, but as the app grows it helps to separate the logic, which stays in the service, from data access, which moves to a repository. That way you can change where the data comes from, for example from memory to a database, without touching the service, and replace the repository in tests.

This guide builds on the [first app](../first-app/) project.

## Define the repository

First you define what the repository offers, with an interface:

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

TypeScript erases interfaces when compiling, so they can't be used to ask for a dependency. `BOOKS_REPOSITORY` is the token that represents it: whoever asks for it gets something that fulfills `BooksRepository`. It's the same thing NestJS does with `@Inject()` and a token.

## Write an implementation

This implementation keeps the books in memory. The `Book` interface now lives in the repository:

```ts title="src/books/in-memory-books.repository.ts"
import { Injectable } from 'viga';
import type { Book, BooksRepository } from './books.repository.ts';

@Injectable()
export class InMemoryBooksRepository implements BooksRepository {
  private readonly books: Book[] = [
    { id: 1, title: 'Dune' },
    { id: 2, title: 'Foundation' },
  ];

  async findAll() {
    return this.books;
  }
}
```

## Ask for the repository from the service

The service asks for the repository by its token and doesn't know which implementation is behind it:

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

`inject(BOOKS_REPOSITORY)` returns a value typed as `BooksRepository`. If you call a method the interface doesn't have, TypeScript flags it as an error.

## Choose the implementation in the module

The module decides which implementation goes with the token:

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

To switch to a database, you write another implementation and only change `useClass`. Neither the service nor the controller changes.

## Replace it in tests

`createTestingApp`, from `viga/testing`, starts the app and replaces the repository without touching its code:

```ts title="src/books/books.test.ts"
import { createTestingApp } from 'viga/testing';
import { AppModule } from '../app.module.ts';
import { BOOKS_REPOSITORY } from './books.repository.ts';

const app = await createTestingApp(AppModule, {
  overrides: [
    { provide: BOOKS_REPOSITORY, useValue: { findAll: async () => [{ id: 9, title: 'Test book' }] } },
  ],
});

const { body } = await app.request('/books');
await app.close();
```

`body` holds the test book: the service and the controller are the real ones, and only the repository changed. You can run this file with `tsx` or inside your test tool, like `node:test`, which you'll see in the testing section.
