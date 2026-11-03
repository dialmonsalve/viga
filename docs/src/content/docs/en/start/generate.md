---
title: Generating code
description: Create a complete resource, a module, a controller or a service with a command, without viga touching your existing files.
sidebar:
  order: 5
---

`viga generate` creates the files for a new feature. It comes included in the `@vigajs/core` package, so there's nothing else to install. Run it from your project's root:

```sh
pnpm exec viga generate resource books
```

With npm and yarn it's `npx viga` and `yarn viga`, and `g` is an alias of `generate`.

| Kind | What it creates |
| --- | --- |
| `resource` | A module, a controller with CRUD routes, a service and its schemas |
| `module` | A module |
| `controller` | A controller |
| `service` | A service |

## A resource

```txt
$ pnpm exec viga g resource books

created src/books/books.module.ts
created src/books/books.controller.ts
created src/books/books.service.ts
created src/books/books.schemas.ts

Add BooksModule to the imports of src/app.module.ts.
Its routes are private by default: add @Public() to open one, or set up app.useAuthGuard().
The service keeps its data in memory: replace it with your database when you are ready.
```

The result compiles and works from the start, with these validated routes:

| Route | What it does |
| --- | --- |
| `GET /books` | Lists them all |
| `GET /books/:id` | Returns one, or 404 |
| `POST /books` | Creates one |
| `PATCH /books/:id` | Updates one |
| `DELETE /books/:id` | Deletes one |

It's a starting point. Three things are left to you:

- **Register the module.** viga doesn't edit your files, so add `BooksModule` to the `imports` of `app.module.ts`.
- **Decide who has access.** Routes are [private by default](../../core/guards/#private-routes-by-default). Without an authentication guard they respond 401: add `@Public()` or set up `app.useAuthGuard()`.
- **Change the storage.** The service keeps data in memory, and it's lost on restart. Replace it with your database.

## Validation

The schemas use the library in your `package.json` `dependencies`, Zod or Valibot. To specify it, or if you use another one, add `--schema zod` or `--schema valibot`. With another library, you'll have to rewrite `books.schemas.ts`. `module`, `controller` and `service` don't need one. `resource` uses `@vigajs/validation`, which `pnpm create @vigajs` already installs. If you don't have it, add it.

## Individual pieces

```sh
pnpm exec viga g module shop
pnpm exec viga g controller shop
pnpm exec viga g service shop
```

All three files go in `src/shop/`. Since the generator doesn't edit anything, it tells you where to register each piece: add the controller to `controllers` and the service to `providers`.

## Names and folders

The name is lowercase, with hyphens if it has several words: `order-items` creates `OrderItemsModule` and the `/order-items` route. Schemas use a singular version, like `CreateOrderItem`. That conversion is simple and only covers regular English plurals, so check it if your name is different.

To create the resource inside another folder, include it in the name. The folder doesn't change the API route, which is still `/books`:

```sh
pnpm exec viga g resource admin/books
```

That creates `src/admin/books/`. If your code isn't in `src`, set the base folder with `--path`, always inside your project:

```sh
pnpm exec viga g service audit --path lib
```

Each part of the name follows the same format, so `..` can't be used to leave the project.

## Your files are safe

The generator never changes an existing file. If any of the ones it would create already exists, it creates none and tells you which ones they are.
