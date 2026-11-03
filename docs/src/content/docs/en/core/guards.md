---
title: Guards
description: How viga decides whether a request can reach a route, with the authentication guard, @Public() and per-route guards.
sidebar:
  order: 4
---

A guard decides whether a request can go on to the controller method. It returns `true` to let it through or `false` to reject it.

viga has two kinds of guards:

- **The authentication guard**, one for the whole app. It answers the question "who are you?" and protects every route except those marked with `@Public()`.
- **Per-route guards**, which you add with `@UseGuards()`. They answer the question "are you allowed to do this?", for example whether the user is an administrator.

## Private routes by default

In viga every route is private. If the app has no authentication guard, private routes respond 401, and at startup viga warns you how many there are:

```txt
No auth guard is configured, so the 3 private routes will respond 401; add app.useAuthGuard() or mark public routes with @Public()
```

That way no route is left open by accident. To open one, mark it with `@Public()`, on the method or on the whole class. You saw it in [controllers](../controllers/#private-routes-by-default).

## The authentication guard

A guard is a class with a `canActivate` method, which receives the same context as the controller methods:

```ts title="src/auth/auth.guard.ts"
import { Injectable, inject, type CanActivate, type HttpContext } from 'viga';
import { SessionsService } from './sessions.service.ts';
import { CURRENT_USER } from './current-user.ts';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly sessions = inject(SessionsService);

  async canActivate({ req }: HttpContext) {
    const user = await this.sessions.findUser(req.headers.authorization);
    if (!user) return false;
    CURRENT_USER.set(user);
    return true;
  }
}
```

It is registered only once, in `main.ts`:

```ts title="src/main.ts" ins={7}
import { createApp } from 'viga';
import { AppModule } from './app.module.ts';
import { AuthGuard } from './auth/auth.guard.ts';

const app = createApp({ rootModule: AppModule, globalPrefix: '/api' })
  .enableShutdownHooks()
  .useAuthGuard(AuthGuard);

await app.listen();
```

viga runs this guard before every private route. If it returns `false`, viga responds 401 and the method doesn't run. How you verify the session or token is up to you: viga ships no JWT or sessions, and you can use whatever library you prefer.

`AuthGuard` can ask for providers with `inject()` and doesn't need to be declared in `providers`: viga creates it with the root module's container, so it can ask for whatever that module sees, global modules included.

### Share the user with the rest of the code

The guard stores the user in `CURRENT_USER`, a context key. Any code that runs during that request can read it without receiving it as a parameter:

```ts title="src/auth/current-user.ts"
import { createContextKey } from 'viga';

export interface User {
  id: number;
  role: 'admin' | 'editor' | 'reader';
}

export const CURRENT_USER = createContextKey<User>('currentUser');
```

```ts title="src/books/books.controller.ts"
@Get('/mine')
mine() {
  return this.books.findByOwner(CURRENT_USER.get().id);
}
```

`CURRENT_USER.get()` returns a `User`, not a `User | undefined`, so you don't need to check it or write `!`. If you come from NestJS, this is what replaces `req.user!.id`: there, `req.user` is optional for TypeScript even though the guard already filled it. If a configuration mistake left no user, `get()` throws a clear error instead of letting an `undefined` through.

Each request has its own value: two simultaneous requests never see each other's user. Context keys are explained in detail in the [request lifecycle](../request-lifecycle/#the-request-context).

:::caution
On a `@Public()` route the authentication guard doesn't run, so `CURRENT_USER` has no value even if the request carries a valid session. `CURRENT_USER.get()` throws if there is no value; in code that also runs on public routes, use `CURRENT_USER.find()`, which returns `undefined`.
:::

## Per-route guards

Knowing who you are isn't enough for everything. To check permissions, add guards with `@UseGuards()`:

```ts title="src/auth/admin.guard.ts"
import { Injectable, type CanActivate } from 'viga';
import { CURRENT_USER } from './current-user.ts';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate() {
    return CURRENT_USER.get().role === 'admin';
  }
}
```

```ts title="src/books/books.controller.ts"
@Delete('/:id')
@UseGuards(AdminGuard)
remove({ params }: HttpContext) {
  this.books.remove(Number(params.id));
}
```

If a `@UseGuards()` guard returns `false`, viga responds **403**, not 401: the user is authenticated but not allowed. Since the authentication guard has already run, `AdminGuard` can safely use `CURRENT_USER.get()`.

`@UseGuards()` also goes on the class, and then it protects every route of the controller. It accepts several guards, which run in order: `@UseGuards(AdminGuard, ActiveAccountGuard)`.

### Guards as functions

If the guard doesn't need providers, it can be a function:

```ts
const isAdmin = () => CURRENT_USER.get().role === 'admin';

@UseGuards(isAdmin)
```

It works the same as the class. Use a class when you need `inject()`.

### A response other than 403

To respond with another code, throw an exception instead of returning `false`. viga responds with the exception you throw:

```ts
canActivate() {
  if (this.maintenance.isActive()) throw new ServiceUnavailableException();
  return CURRENT_USER.get().role === 'admin';
}
```

### Create your own decorators

If you repeat the same combination of guards on several routes, group it in a function that returns `UseGuards()`:

```ts title="src/auth/admin-only.ts"
import { UseGuards } from 'viga';
import { ActiveAccountGuard } from './active-account.guard.ts';
import { AdminGuard } from './admin.guard.ts';

export const AdminOnly = () => UseGuards(ActiveAccountGuard, AdminGuard);
```

```ts title="src/books/books.controller.ts"
@Delete('/:id')
@AdminOnly()
remove({ params }: HttpContext) {
  this.books.remove(Number(params.id));
}
```

It works on the method and on the class, like `@UseGuards()`.

If the decorator needs parameters, the function receives them and creates the guard with them:

```ts title="src/auth/roles.ts"
import { UseGuards } from 'viga';
import { CURRENT_USER, type User } from './current-user.ts';

export const Roles = (...roles: User['role'][]) =>
  UseGuards(() => roles.includes(CURRENT_USER.get().role));
```

```ts
@Post()
@Roles('admin', 'editor')
create({ body }: HttpContext<{ body: typeof CreateBook }>) {
  return this.books.create(body);
}
```

If the guard also needs providers, create the class inside the function. Each call creates its own class with the parameters it received, and that class can use `inject()`:

```ts title="src/billing/require-plan.guard.ts"
import { Injectable, inject, type CanActivate } from 'viga';
import { CURRENT_USER } from '../auth/current-user.ts';
import { BillingService, type Plan } from './billing.service.ts';

export function RequirePlan(plan: Plan) {
  @Injectable()
  class RequirePlanGuard implements CanActivate {
    private readonly billing = inject(BillingService);

    async canActivate() {
      return (await this.billing.planOf(CURRENT_USER.get().id)) === plan;
    }
  }
  return RequirePlanGuard;
}
```

It combines with other guards like any other:

```ts title="src/billing/pro-only.ts"
import { UseGuards } from 'viga';
import { ActiveAccountGuard } from '../auth/active-account.guard.ts';
import { RequirePlan } from './require-plan.guard.ts';

export const ProOnly = () => UseGuards(ActiveAccountGuard, RequirePlan('pro'));
```

And if you want each route to pick the plan, pass it through the decorator: `export const PlanOnly = (plan: Plan) => UseGuards(ActiveAccountGuard, RequirePlan(plan))`, and on the route `@PlanOnly('pro')`.

These decorators are plain functions, so they accept any value: arrays, if you define `Roles` as `(roles: User['role'][]) => ...` and use it as `@Roles(['admin', 'editor'])`, or options objects, like `RequirePlan({ plan: 'pro', allowTrial: true })`. An object pays off when there are several parameters or some are optional, because it reads without looking at the definition.

:::caution
Decorator arguments are evaluated only once, when the class is loaded, not on every request. Pass only fixed values. Whatever depends on the request, like the user, the parameters or the headers, is read inside `canActivate`.
:::

If you come from NestJS, this replaces `applyDecorators()` and the combination of `@SetMetadata()` with a guard that reads the roles. In viga the guard receives the roles directly and reads the user from `CURRENT_USER`, so no separate metadata is needed.

## The order they run in

For a private route, viga runs the guards in this order and stops at the first one that rejects:

1. The authentication guard. If it rejects: 401.
2. The `@UseGuards()` guards on the class. If one rejects: 403.
3. The `@UseGuards()` guards on the method. If one rejects: 403.

On a `@Public()` route only step 1 is skipped. The `@UseGuards()` guards still run: `@Public()` removes authentication, not permissions.

## `@Public()` is not inherited

If a controller extends another one marked with `@Public()`, the child is private until it repeats `@Public()`. The same goes for a method that overrides a public one. Routes and guards are inherited.

That way, extending a public class never opens new routes by accident.

## Routes that don't exist

When the app has an authentication guard, a route that doesn't exist answers like a private one: 401 to anyone without a session and 404 to anyone with one. That way, an unauthenticated client can't find out which routes exist by trying URLs.

This behavior is called `concealRoutes` and turns on by itself when you use `useAuthGuard()`. You can force it with `createApp({ concealRoutes: true })` or turn it off with `false`.

## Review which routes are public

At startup, viga lists the public routes in the log, at `debug` level:

```txt
Public routes: GET /api/books, POST /api/auth/login
```

Review it before every deploy: it is the list of everything anyone can call without authenticating.
