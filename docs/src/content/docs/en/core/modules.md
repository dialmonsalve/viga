---
title: Modules
description: How viga organizes the app into modules, what each one can see, how they share providers and when to use a global module.
sidebar:
  order: 1
---

A module groups the controllers and providers of one feature. The app is a tree of modules: the root module, the one you pass to `createApp`, imports the others, and each of them can import more.

In the [first app](../../start/first-app/) you already wrote two: `BooksModule` and `AppModule`. This page explains what happens between them.

## The `@Module` options

| Option | What it does |
| --- | --- |
| `imports` | Modules whose exported providers you want to use. |
| `controllers` | The module's controllers. viga registers their routes. |
| `providers` | Classes and values the module creates and can inject. |
| `exports` | Providers of the module that other modules can use when they import it. |
| `global` | Makes its exports available to the whole app. Covered below. |

All of them are optional. A module with no options, `@Module({})`, is valid, although it adds nothing.

## Every module is private by default

Each module has its own container. A provider declared in `providers` can only be injected by classes of that same module, unless you export it.

Say you add authors to the app and want `BooksService` to use `AuthorsService`:

```ts title="src/authors/authors.module.ts"
import { Module } from 'viga';
import { AuthorsService } from './authors.service.ts';

@Module({
  providers: [AuthorsService],
})
export class AuthorsModule {}
```

```ts title="src/books/books.module.ts"
import { Module } from 'viga';
import { AuthorsModule } from '../authors/authors.module.ts';
import { BooksController } from './books.controller.ts';
import { BooksService } from './books.service.ts';

@Module({
  imports: [AuthorsModule],
  controllers: [BooksController],
  providers: [BooksService],
})
export class BooksModule {}
```

Even though `BooksModule` imports `AuthorsModule`, the app does not start:

```txt
[DI] BooksModule cannot resolve AuthorsService: it is missing from providers or from the exports of an imported module
```

`AuthorsService` exists, but it is private to `AuthorsModule`. Importing a module only gives access to what it exports.

## Export what others need

Add `AuthorsService` to `exports`:

```ts title="src/authors/authors.module.ts" ins={6}
import { Module } from 'viga';
import { AuthorsService } from './authors.service.ts';

@Module({
  providers: [AuthorsService],
  exports: [AuthorsService],
})
export class AuthorsModule {}
```

Now `BooksService` can ask for it with `inject(AuthorsService)`. Whatever you don't export stays an internal detail of the module: you can change it without breaking anyone.

You only export providers the module declares or receives from its imports. Controllers are not exported: their routes are registered anyway, no matter who imports the module.

## One instance per provider

viga loads each module only once, even when several modules import it. If `BooksModule` and `ReviewsModule` both import `AuthorsModule`, they both get the same `AuthorsService` instance.

Within a module, each provider is created the first time someone asks for it and reused afterwards. That is why a provider can hold state, like the in-memory list of books in the first app.

:::caution
If you declare the same class in the `providers` of two different modules, each module creates its own instance and the state is not shared. To share a provider, declare it in one module, export it and import that module wherever you need it.
:::

## Re-export modules

A module can export a module it imports. Whoever imports it then also gets the exports of that other module:

```ts title="src/shared/shared.module.ts"
import { Module } from 'viga';
import { AuthorsModule } from '../authors/authors.module.ts';
import { PublishersModule } from '../publishers/publishers.module.ts';

@Module({
  imports: [AuthorsModule, PublishersModule],
  exports: [AuthorsModule, PublishersModule],
})
export class SharedModule {}
```

Importing `SharedModule` is the same as importing `AuthorsModule` and `PublishersModule`. It is useful to group modules that are almost always used together.

## Global modules

Some providers are needed by almost the whole app, like the configuration. Importing their module everywhere would be repetitive; with `global: true`, its exports are available in every module without importing it:

```ts title="src/clock/clock.module.ts"
import { Module } from 'viga';
import { Clock } from './clock.ts';

@Module({
  global: true,
  providers: [Clock],
  exports: [Clock],
})
export class ClockModule {}
```

A global module is imported once, in the root module:

```ts title="src/app.module.ts"
import { Module } from 'viga';
import { BooksModule } from './books/books.module.ts';
import { ClockModule } from './clock/clock.module.ts';

@Module({ imports: [ClockModule, BooksModule] })
export class AppModule {}
```

If you import it from another module, viga does not start and tells you where to move it:

```txt
[Module] ClockModule is global and is imported from BooksModule, but not from the root module; move it to the imports of AppModule
```

This rule keeps every global module visible in a single file. `ConfigModule.forRoot()`, from `viga/config`, is a global module and is imported this way.

:::tip
Use global modules only for what is truly cross-cutting. An explicit import makes clear what each module depends on; a global one hides it.
:::

## Where viga looks for a provider

When a class asks for a provider with `inject()`, viga looks for it in this order and uses the first one it finds:

1. The module's own `providers`.
2. The `exports` of the modules it imports, including what those re-export.
3. The `exports` of the global modules.

If it is not found in any of them, the app does not start and the error names the module and the missing provider.

## Errors when loading modules

viga checks the module tree at startup and fails before opening the port:

- **Circular import.** If `BooksModule` imports `AuthorsModule` and `AuthorsModule` imports `BooksModule`, the error shows the chain from the root module: `[Module] Circular import: AppModule -> BooksModule -> AuthorsModule -> BooksModule`. It usually means there is a provider that should live in a third module both of them import.
- **Class without `@Module()`.** If you put a class that is not a module in `imports`: `[Module] AuthorsService must be decorated with @Module()`.
