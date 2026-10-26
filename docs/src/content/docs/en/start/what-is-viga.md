---
title: What is viga
description: HTTP framework for Node.js with modules, dependency injection and standard decorators.
sidebar:
  order: 1
---

viga is an HTTP framework for Node.js built on top of Express 5. It organizes an API into modules, resolves their dependencies with dependency injection and uses standard JavaScript decorators to declare controllers, routes, guards and interceptors.

## The problem it solves

Express is small and flexible, but it leaves almost everything up to you. Every new project means deciding how to organize the code, how to share services across the app, how to validate incoming data, how to respond to errors and which headers and limits to set. Each team solves it its own way, and those decisions get repeated from project to project.

viga starts from a structure that is already decided. You define modules, controllers and services, and the framework wires them together. The app also starts closed: every route is private until you mark it public with `@Public()`, and if you don't configure how to authenticate, private routes respond 401 instead of being left open by mistake.

## Who it is for

viga is for people building HTTP APIs with Node.js and TypeScript who want:

- A clear structure from day one, without having to invent it.
- To start from a closed app and open only what they decide, instead of closing later whatever was left exposed.
- The freedom to choose their tools: the validation library, the ORM or the way to authenticate.
- To keep using the Express ecosystem and its familiar middlewares.

If you come from NestJS, the way the code is organized will feel familiar.

## Main ideas

### Standard JavaScript decorators

viga uses standard JavaScript decorators, the TC39 proposal that TypeScript supports without experimental options. It doesn't need `reflect-metadata`, `experimentalDecorators` or `emitDecoratorMetadata`. Dependencies are requested explicitly with `inject()`:

```ts
@Injectable()
class BooksService {
  private readonly database = inject(DatabaseService);
}
```

### A small core and optional modules

The core only includes what every API needs: modules, dependency injection, controllers, guards, interceptors, HTTP exceptions and lifecycle. Everything else lives in optional subpaths, such as `viga/validation`, `viga/config`, `viga/i18n`, `viga/pagination`, `viga/drizzle`, `viga/websocket` and `viga/testing`. If you don't import them, nothing extra gets installed.

### Closed by default

Besides private routes, viga comes with defaults turned on that reduce common risks:

- Security headers, a body size limit and maximum times to receive each request.
- A route without a body schema doesn't accept a body, so unvalidated data never reaches your code.
- Forms submitted from other sites are rejected, which is the usual path of a CSRF attack.
- When there is an authentication guard, unknown routes respond like private ones to anyone without a session, so the existing routes can't be discovered.

Each one can be adjusted or turned off explicitly. These defaults don't make an application secure on their own: security also depends on your code, your configuration and your infrastructure.

### Choose your tools

viga doesn't tie you to a specific library. Validation works with any library compatible with [Standard Schema](https://standardschema.dev), such as Zod, Valibot or ArkType. The database can use the Drizzle module or any other ORM through a provider. And to authenticate, you set up your own guard with the library you prefer.

### Promises, no RxJS

Handlers, guards and interceptors work with promises and `async/await`. There are no observables to learn.

## Inspired by NestJS

viga is inspired by [NestJS](https://nestjs.com). Modules, dependency injection, decorator-based controllers, guards and interceptors come from the ideas Kamil Myśliwiec and the Nest community have spent years refining.

viga shares no code with Nest. It takes those ideas somewhere else: standard decorators instead of `experimentalDecorators` and `reflect-metadata`, promises instead of RxJS and a small core with everything else optional.

From [Express](https://expressjs.com) it takes the foundation: viga runs on Express 5, so its middlewares, such as `cors`, work with `app.use()`, and every handler has the Express request and response at hand when it needs them.

## What viga doesn't do

viga sticks to what almost every HTTP API needs. Whatever can be done well from outside isn't part of the framework, so it stays small and easy to understand. That's why it doesn't include:

- Its own authentication system, such as JWT, OAuth or sessions. viga gives you the place to plug it in, `app.useAuthGuard()`, and you choose the library.
- Caching, queues or scheduled jobs.
- Sending email or file storage.
- GraphQL or microservices.

For several of these needs, the documentation will include guides that show how to integrate them with well-known libraries.
