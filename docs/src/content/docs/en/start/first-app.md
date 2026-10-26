---
title: First app
description: Build an API with a module, a controller and a service, and start it step by step.
sidebar:
  order: 3
---

In this guide you build a small API that lists books. It shows the three pieces every viga app is made of: services, controllers and modules. Before you start, follow the installation steps.

## Project structure

When you're done, the project will have these files:

```txt
src/
  books/
    books.service.ts
    books.controller.ts
    books.module.ts
  app.module.ts
  main.ts
```

Each feature lives in its own folder with its module. `app.module.ts` brings them together and `main.ts` starts the app.

## The service

A service holds the app's logic. Here it returns a fixed list of books. In a real app it would query the database.

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
    { id: 2, title: 'Foundation' },
  ];

  findAll() {
    return this.books;
  }
}
```

`@Injectable()` lets viga create the service and hand it to whoever asks for it.

## The controller

A controller receives HTTP requests and responds. It holds no logic: it asks the service for it.

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

- `@Controller('/books')` sets the prefix for all the controller's routes.
- `@Get()` responds to `GET /books`. Whatever the method returns is sent as JSON, and if it's a promise, viga waits for it to resolve.
- `inject(BooksService)` asks for the service. viga creates it once and shares it.
- `@Public()` opens the route. Without it, the route would be private.

## The module

A module groups the controllers and services of a feature.

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

Services go in `providers`. Only this module's controllers and services can ask for them, unless the module exports them.

## The root module

The root module brings the app's modules together:

```ts title="src/app.module.ts"
import { Module } from 'viga';
import { BooksModule } from './books/books.module.ts';

@Module({ imports: [BooksModule] })
export class AppModule {}
```

## Start the app

```ts title="src/main.ts"
import { createApp } from 'viga';
import { AppModule } from './app.module.ts';

const app = createApp({ rootModule: AppModule, globalPrefix: '/api' }).enableShutdownHooks();

await app.listen();
```

- `globalPrefix` puts `/api` in front of every route.
- `enableShutdownHooks()` shuts the app down in order when the process stops, for example with `Ctrl+C`.
- `listen()` starts listening on port 3000. The port is optional: `listen(8080)` uses a different one. viga doesn't read the `PORT` environment variable on its own; if you use it, pass it yourself: `app.listen(Number(process.env.PORT ?? 3000))`.

Start it in development mode:

```sh
pnpm dev
```

## Try the API

```sh
curl http://localhost:3000/api/books
```

```json
[{ "id": 1, "title": "Dune" }, { "id": 2, "title": "Foundation" }]
```

## Routes are private by default

Remove `@Public()` from the controller and try again. The route responds 401:

```json
{
  "statusCode": 401,
  "code": "errors.unauthorized",
  "message": "You must sign in to continue",
  "error": "Unauthorized"
}
```

Also, on startup, the app warns you how many private routes have no way to authenticate:

```txt
[App] No auth guard is configured, so the 1 private routes will respond 401; add app.useAuthGuard() or mark public routes with @Public()
```

In viga, a route is opened on purpose, never by oversight. For routes that require a session, you set up your own authentication with `app.useAuthGuard()`, as you'll see in the core section.

## Optional: move data access into a repository

The app already works as it is. As it grows, it helps to separate the logic, which lives in the service, from data access, which moves to a repository. That way you can change where the data comes from, for example from memory to a database, without touching the service, and replace the repository in tests.

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

Then you write an implementation. This one keeps the books in memory, and the `Book` interface now lives in the repository:

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

Finally, the module decides which implementation goes with the token:

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

To switch to a database, you write another implementation and only change `useClass`. The controller doesn't change.

In a test, `createTestingApp`, from `viga/testing`, starts the app and replaces the repository without touching its code:

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

## Next steps

You now have an app with a module, a controller and a service. From here you can validate incoming data, organize more modules and connect a database, which is what the following sections cover.
