---
title: viga/testing
description: Test your app with real HTTP requests, replacing the providers you don't want to use in tests, like the database or an external service.
sidebar:
  order: 7
---

`viga/testing` starts your app on a free port and lets you make real HTTP requests to it. Requests go through the whole path: guards, validation, interceptors, controllers and services, just like in production. Whatever you don't want to use in a test, like the database or a payment service, you replace with a fake version.

It ships no test runner of its own. The examples use `node:test`, the one that comes with Node.js, which needs nothing installed.

## Your first test

```ts title="src/books/books.test.ts"
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createTestingApp } from 'viga/testing';
import { AppModule } from '../app.module.ts';

it('lists the books', async () => {
  const app = await createTestingApp(AppModule);

  try {
    const { status, body } = await app.request('/books');
    assert.equal(status, 200);
    assert.deepEqual(body, [{ id: 1, title: 'Dune' }, { id: 2, title: 'Foundation' }]);
  } finally {
    await app.close();
  }
});
```

`createTestingApp` takes the root module and returns the app already listening on a free port of `127.0.0.1`. `app.request()` makes a request to it and returns the status code, the headers and the body, already parsed if the response is JSON.

`app.close()` stops the server and closes the providers. Put it in a `finally` so it runs even if the test fails; otherwise the test process may hang.

## Run the tests

Node.js doesn't understand decorators yet, so tests run with `tsx`, the same one you use in development. Add a script to your `package.json`:

```json title="package.json"
{
  "scripts": {
    "test": "node --import tsx --test \"src/**/*.test.ts\""
  }
}
```

And run it with `pnpm test`, `npm test`, `yarn test` or `bun run test`, depending on your package manager.

## One app for several tests

Starting the app in every test is the most isolated option, but also the slowest. If the tests in a file don't affect each other, share a single app with `before` and `after`:

```ts title="src/books/books.test.ts"
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTestingApp, type TestingApp } from 'viga/testing';
import { AppModule } from '../app.module.ts';

describe('books', () => {
  let app: TestingApp;

  before(async () => {
    app = await createTestingApp(AppModule);
  });

  after(() => app.close());

  it('lists the books', async () => {
    const { status } = await app.request('/books');
    assert.equal(status, 200);
  });

  it('responds 404 if the book does not exist', async () => {
    const { status } = await app.request('/books/99');
    assert.equal(status, 404);
  });
});
```

## Make requests

`app.request()` accepts the method, a JSON body and headers:

```ts
const { status, body, headers } = await app.request('/books', {
  method: 'POST',
  json: { title: 'Dune', year: 1965 },
  headers: { authorization: 'Bearer test-token' },
});

assert.equal(status, 201);
assert.equal(headers.get('x-request-id')?.length, 36);
```

With `json`, viga adds the `content-type: application/json` header for you. To send another kind of body, use `body` with text or bytes, and set the header yourself.

To type the response body, pass the type: `app.request<Book[]>('/books')`.

## Replace providers

The `overrides` option replaces providers without touching the app's code. It uses the same shape as a module's providers, usually with `useValue`:

```ts
const app = await createTestingApp(AppModule, {
  overrides: [
    { provide: BOOKS_REPOSITORY, useValue: { findAll: async () => [{ id: 9, title: 'Test book' }] } },
  ],
});
```

The controller and the service are the real ones; only the repository changes. You saw it in [repositories](../../start/repositories/#replace-it-in-tests).

A few things worth knowing:

- **The original provider is never created.** If you replace `DatabaseService`, the app doesn't open any database connection, not even at startup.
- **It works in any module**, imported and global ones included, without changing which modules can see it.
- **An override that matches no provider throws**, so a misspelled token doesn't go unnoticed:

```txt
[Testing] The override for InjectionToken(BOOKS_REPOSITORY) does not match any provider; check that the token is the same one the module declares
```

### Change the configuration

To use a different configuration in tests without touching `process.env`, replace `CONFIG`:

```ts
import { CONFIG } from 'viga/config';

const app = await createTestingApp(AppModule, {
  overrides: [{ provide: CONFIG, useValue: { PORT: 0, DATABASE_URL: 'postgres://localhost/test', JWT_SECRET: 'x'.repeat(32) } }],
});
```

This value isn't validated against the [`viga/config`](../config/) schema: write a complete, correct object.

## Authentication in tests

`createTestingApp` keeps the production defaults: private routes respond 401 until you set an authentication guard, and `requireValidation` and CSRF protection stay on. That way tests catch the same mistakes you'd see in production.

To test private routes, use `configure`, which receives the app before it starts. With a fake guard that always lets requests through and stores a test user, your services work as they would with a real user:

```ts
import { CURRENT_USER } from '../auth/current-user.ts';

const app = await createTestingApp(AppModule, {
  configure: (app) =>
    app.useAuthGuard(() => {
      CURRENT_USER.set({ id: 1, role: 'admin' });
      return true;
    }),
});
```

To test that a route rejects unauthenticated requests, create another app without `configure` and check that it responds 401.

`createTestingApp` accepts the same options as `createApp`, like `globalPrefix`. By default it uses a silent logger so the test output stays clean; pass `logger` if you want to see the logs.

## Other tools

- `app.get(token)` returns a provider the root module can see, for example to prepare data before a request or check the state afterwards.
- `app.url(path)` returns the full URL, like `http://127.0.0.1:41235/books`, to use with another HTTP client. For a WebSocket, change `http://` to `ws://`.
- `app.app` is the viga app behind it, in case you need something `createTestingApp` doesn't expose.
