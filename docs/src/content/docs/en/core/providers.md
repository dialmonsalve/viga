---
title: Providers and dependency injection
description: What a provider is, how to ask for one with inject(), the four ways to declare it and the errors viga catches at startup.
sidebar:
  order: 2
---

A provider is something viga's container creates and hands to whoever asks for it: a service, a repository, a configuration value. Instead of each class creating what it needs with `new`, it asks for it with `inject()` and the container decides what to hand over.

That brings two advantages. Each provider is created only once and shared, and you can replace one with another without touching whoever uses it, as you saw in [repositories](../../start/repositories/).

## Declare a provider and ask for it

A class becomes a provider with `@Injectable()` and by declaring it in the `providers` of a module:

```ts title="src/clock/clock.ts"
import { Injectable } from 'viga';

@Injectable()
export class Clock {
  now() {
    return new Date();
  }
}
```

```ts title="src/books/books.module.ts"
import { Module } from 'viga';
import { Clock } from '../clock/clock.ts';
import { BooksController } from './books.controller.ts';
import { BooksService } from './books.service.ts';

@Module({
  controllers: [BooksController],
  providers: [BooksService, Clock],
})
export class BooksModule {}
```

Another class of the module asks for it with `inject()` in a field:

```ts title="src/books/books.service.ts"
import { Injectable, inject } from 'viga';
import { Clock } from '../clock/clock.ts';

@Injectable()
export class BooksService {
  private readonly clock = inject(Clock);

  findAll() {
    return { books: [], generatedAt: this.clock.now() };
  }
}
```

`inject(Clock)` returns an instance typed as `Clock`, with no extra annotations. Controllers ask for providers the same way, although they are declared in `controllers`, not in `providers`.

## Why `inject()` and not the constructor

Standard JavaScript decorators, the ones viga uses, do not expose the types of the constructor parameters. So viga cannot know what a constructor asks for, and dependencies are requested explicitly with `inject()`. In exchange, you need neither `reflect-metadata` nor `emitDecoratorMetadata`.

If you come from NestJS: there, dependencies arrive through the constructor because TypeScript emits their types with `emitDecoratorMetadata` and NestJS reads them with `reflect-metadata`.

`inject()` only works while the container is constructing the class: in a field initializer, as above, or inside the constructor. If you call it later, for example inside a method, it fails:

```txt
[DI] inject(Clock) can only be called while the container is constructing a class
```

The fix is to ask for the dependency in a field and use it from the method.

## The four ways to declare a provider

| Form | Who creates the object | When to use it |
| --- | --- | --- |
| `Clock` | The container, with `new Clock()` | The short form of `{ provide: Clock, useClass: Clock }`. The usual one for your services. |
| `{ provide: TOKEN, useClass: Class }` | The container, with `new Class()` | The token differs from the class, for example an interface with several implementations. |
| `{ provide: TOKEN, useValue: value }` | Nobody: it already exists | The value is ready, like an options object or an instance created somewhere else. |
| `{ provide: TOKEN, useFactory: () => value }` | Your function, once at startup | The constructor needs arguments, the class is not yours or the value depends on logic. |

`provide` can be a class or an `InjectionToken`. Classes you hand over with the short form or with `useClass` need `@Injectable()`; if it is missing, viga does not start:

```txt
[DI] Clock must be decorated with @Injectable()
```

### `useClass`: pick an implementation

It binds a token to a class: when someone asks for the token, the container creates that class. The short form you have used so far is a case of `useClass` where the token and the class are the same:

```ts
providers: [Clock]
providers: [{ provide: Clock, useClass: Clock }]
```

Both lines do the same thing. The long form makes sense when the token differs from the class, usually an `InjectionToken` that stands for an interface. That is what you did in [repositories](../../start/repositories/):

```ts
providers: [{ provide: BOOKS_REPOSITORY, useClass: InMemoryBooksRepository }]
```

Whoever asks for `inject(BOOKS_REPOSITORY)` gets an `InMemoryBooksRepository`. To move to a database, you only change the class.

### `useValue`: hand over a ready-made value

It is for values that don't need to be constructed, like an options object:

```ts title="src/books/books.options.ts"
import { InjectionToken } from 'viga';

export interface BooksOptions {
  pageSize: number;
}

export const BOOKS_OPTIONS = new InjectionToken<BooksOptions>('BOOKS_OPTIONS');
```

```ts title="src/books/books.module.ts"
providers: [BooksService, { provide: BOOKS_OPTIONS, useValue: { pageSize: 20 } }],
```

`inject(BOOKS_OPTIONS)` returns the object typed as `BooksOptions`.

### `useFactory`: build the value with code

It is for creating objects from classes that are not yours and have no `@Injectable()`, like a library client. The function runs only once and can use `inject()` to ask for other providers:

```ts title="src/search/search.module.ts"
import { LOGGER, Module, inject } from 'viga';
import { SearchClient } from 'some-search-library';
import { SEARCH_CLIENT } from './search.client.ts';

@Module({
  providers: [
    {
      provide: SEARCH_CLIENT,
      useFactory: () => new SearchClient({ url: 'http://localhost:7700', logger: inject(LOGGER) }),
    },
  ],
  exports: [SEARCH_CLIENT],
})
export class SearchModule {}
```

`SEARCH_CLIENT` is an `InjectionToken<SearchClient>` declared in `search.client.ts`, and `some-search-library` stands for whatever library you use.

The function must return the value directly, not a promise. If you need asynchronous work at startup, like connecting to a database, do it in the provider's `onModuleInit` hook, covered in the [app lifecycle](../app-lifecycle/#provider-hooks).

## When they are created

viga creates every provider at startup, before opening the port, and each one only once per module. If a provider fails while being constructed or is missing a dependency, you find out when the app starts, not with the first request.

If a provider asks for another one that does not exist yet, viga creates it right then and hands it over.

## Providers viga already includes

Some providers are available in every module without declaring them. The most useful is `LOGGER`, the app's logger:

```ts title="src/books/books.service.ts"
import { Injectable, LOGGER, inject } from 'viga';

@Injectable()
export class BooksService {
  private readonly logger = inject(LOGGER);

  findAll() {
    this.logger.info('Listing books');
    return [];
  }
}
```

It has the methods `info`, `warn`, `error` and `debug`.

## Circular dependencies

If `BooksService` asks for `ReviewsService` and `ReviewsService` asks for `BooksService`, neither can be created first. viga detects it at startup and shows the chain:

```txt
[DI] Circular dependency in BooksModule: BooksService -> ReviewsService -> BooksService
```

viga offers no way to bypass this error. It almost always means the two services share a responsibility that should live in a third provider both depend on.

It is not the same as a [circular import](../modules/#errors-when-loading-modules), which happens between modules, not between providers.
