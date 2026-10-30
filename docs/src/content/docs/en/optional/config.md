---
title: viga/config
description: Validate and type the environment variables at startup, so a wrong configuration stops the app from starting instead of failing in production.
sidebar:
  order: 2
---

`viga/config` reads the environment variables, validates them with a schema when the app starts and hands them over already converted and typed. If a variable is missing or its value isn't valid, the app doesn't start and the error says which ones fail.

Without this, a misspelled variable shows up as `undefined` in the middle of a request, sometimes days after the deploy. With `viga/config`, the problem comes up when the app starts, before serving anyone.

It works with any library compatible with Standard Schema, the same one you use with [`viga/validation`](../validation/). The examples use Zod.

## Define the schema

Describe the variables your app needs:

```ts title="src/config.ts"
import { z } from 'zod';

export const Env = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
});

declare module 'viga/config' {
  interface Register {
    schema: typeof Env;
  }
}
```

Environment variables are always text, so use `z.coerce` for those that should be numbers or booleans. Here `PORT` goes from `'3000'` to `3000`, and if it isn't set it's `3000` because of the `default`.

The `declare module` block registers your schema in `viga/config`. Thanks to it, TypeScript knows each variable's type when you ask for it. You only write it once in the whole project.

## Register the module

Import `ConfigModule.forRoot` in the root module. It's a global module, so the configuration is available in every module:

```ts title="src/app.module.ts"
import { Module } from 'viga';
import { ConfigModule } from 'viga/config';
import { BooksModule } from './books/books.module.ts';
import { Env } from './config.ts';

@Module({ imports: [ConfigModule.forRoot({ schema: Env }), BooksModule] })
export class AppModule {}
```

## Use the configuration

Ask for `CONFIG` with `inject()` from any provider:

```ts title="src/database/database.service.ts"
import { Injectable, inject, type OnModuleDestroy } from 'viga';
import { CONFIG } from 'viga/config';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly config = inject(CONFIG);
  readonly pool = new Pool({ connectionString: this.config.DATABASE_URL });

  async onModuleDestroy() {
    await this.pool.end();
  }
}
```

`this.config.DATABASE_URL` is a `string` and `this.config.PORT` is a `number`, with no conversions or `undefined` checks. If you misspell a variable name, TypeScript flags it.

### In `main.ts`

viga doesn't read the `PORT` variable on its own. To pass it to `listen()`, start the app with `init()` and read the configuration with `app.get()`:

```ts title="src/main.ts"
import { createApp } from 'viga';
import { CONFIG } from 'viga/config';
import { AppModule } from './app.module.ts';

const app = await createApp({ rootModule: AppModule, globalPrefix: '/api' }).enableShutdownHooks().init();

await app.listen(app.get(CONFIG).PORT);
```

`app.get()` only works after `init()`, because before that the configuration hasn't been validated yet.

## When the configuration isn't valid

If any variable fails, the app doesn't start and the error lists all of them at once:

```txt
[Config] Invalid configuration:
  - DATABASE_URL: Invalid URL
  - JWT_SECRET: Too small: expected string to have >=32 characters
```

That way you can fix them all at once, instead of finding them one by one.

### Values never show up in the error

Environment variables often hold secrets, and errors end up in logs that more people read. That's why viga never shows a variable's value in the error. If a message includes it, for example one you wrote yourself, viga replaces it with `***`:

```txt
  - JWT_SECRET: JWT_SECRET is too short: ***
```

## The configuration can't be modified

viga freezes the result, nested objects and arrays included. No code can change the configuration while the app is running: trying to throws a `TypeError`.

Also, the configuration only holds the variables you declared. The rest of `process.env`, like `PATH` or other services' variables, isn't in `CONFIG`.

## `.env` files

viga doesn't read `.env` files on its own: loading the file is a decision that stays visible in your project. Node.js already knows how to do it, and you have two ways to ask it. Pick whichever you prefer; the result is the same.

### From the code

`process.loadEnvFile()` loads the `.env` file from the folder you start the app from. Call it at the top of `main.ts`:

```ts title="src/main.ts" ins={1,6}
import { existsSync } from 'node:fs';
import { createApp } from 'viga';
import { CONFIG } from 'viga/config';
import { AppModule } from './app.module.ts';

if (existsSync('.env')) process.loadEnvFile();

const app = await createApp({ rootModule: AppModule, globalPrefix: '/api' }).enableShutdownHooks().init();

await app.listen(app.get(CONFIG).PORT);
```

You don't need to touch `package.json`, and it works the same with `tsx` and with `node`. The `existsSync` check keeps the app from failing where there's no file, like in production.

It works even though `AppModule` is imported before the call, because `viga/config` reads the variables when the app starts, not when the module is imported.

### From the scripts

Node.js's `--env-file-if-exists` option does the same from the command line, and `tsx` accepts it too:

```json title="package.json"
{
  "scripts": {
    "dev": "tsx watch --env-file-if-exists=.env src/main.ts",
    "start": "node --env-file-if-exists=.env dist/main.js"
  }
}
```

If the file doesn't exist, Node.js prints a notice and carries on without it. If you'd rather the app not start when the file is missing, use `--env-file` instead.

### Environment variables take priority

Either way, the file never replaces a variable that already exists in the environment. In production, the variables usually come from Docker, Kubernetes or your deployment platform: those always win, even if there's a `.env` on the server.

:::caution
Don't commit the `.env` file: add it to `.gitignore`. If you want to document which variables are needed, commit a `.env.example` with the same keys and sample values.
:::

## Another source of variables

By default, `ConfigModule` reads `process.env`. The `env` option accepts any object, for example one built in a test:

```ts
ConfigModule.forRoot({
  schema: Env,
  env: { DATABASE_URL: 'postgres://localhost/test', JWT_SECRET: 'x'.repeat(32) },
});
```

### Secrets from an external service

If some secrets come from a service like Vault or AWS Secrets Manager, load them first and pass them with `env`, together with the environment variables:

```ts title="src/config.ts"
const secrets = await loadSecretsFromVault();

export const env = { ...process.env, ...secrets };
```

```ts title="src/app.module.ts"
@Module({ imports: [ConfigModule.forRoot({ schema: Env, env }), BooksModule] })
export class AppModule {}
```

`loadSecretsFromVault` stands for whatever function your secrets service uses. Top-level `await` works because the project uses ES modules: when `AppModule` is evaluated, the secrets are already loaded. Then `viga/config` validates them like any other variable.

## The schema must be synchronous

viga validates the configuration synchronously, because providers use it while they're being built: the `Pool` in the earlier example needs `DATABASE_URL` at that very moment. If the schema has asynchronous validations, like a `refine` that queries a service, the app doesn't start and the error explains why.

What usually motivates an asynchronous validation has its own place:

- **Loading secrets** from an external service: before starting, as in the previous example.
- **Checking that a service answers**, like the database: in its provider's `onModuleInit`, as explained in the [app lifecycle](../../core/app-lifecycle/#provider-hooks).
