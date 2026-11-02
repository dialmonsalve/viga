---
title: Multi-tenant with subdomains
description: One app for several companies, each on its own subdomain, with separated data and no way for a user to get into another company.
sidebar:
  order: 4
---

In a multi-tenant app, several companies (*tenants*) use the same app and the same database, each with its own data. A common way to separate them is the subdomain: `acme.myapp.com` is the company Acme and `globex.myapp.com` is Globex.

viga has nothing specific for this, because it can be solved with pieces it already has: a middleware that identifies the company, a [context key](../../core/request-lifecycle/#the-request-context) that stores it and a guard that checks the user belongs to it.

:::caution
The most serious mistake in a multi-tenant app is a user seeing another company's data. Everything the client sends, the subdomain included, can be forged. Identifying the company isn't enough: you always have to check the user belongs to it, and filter every query.
:::

## Identify the company

A context key stores the current request's company:

```ts title="src/tenants/current-tenant.ts"
import { createContextKey } from '@vigajs/core';

export interface Tenant {
  id: number;
  slug: string;
}

export const CURRENT_TENANT = createContextKey<Tenant>('currentTenant');
```

A middleware reads the subdomain, looks up the company and stores it. If it doesn't exist, it responds 404:

```ts title="src/tenants/tenant.middleware.ts"
import type { RequestHandler } from 'express';
import { NotFoundException } from '@vigajs/core';
import { CURRENT_TENANT } from './current-tenant.ts';
import type { TenantsService } from './tenants.service.ts';

const BASE_DOMAIN = 'myapp.com';

function slugFrom(hostname: string) {
  const suffix = `.${BASE_DOMAIN}`;
  if (!hostname.endsWith(suffix)) return undefined;

  const slug = hostname.slice(0, -suffix.length);
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) ? slug : undefined;
}

export function tenantMiddleware(tenants: () => TenantsService): RequestHandler {
  return async (req, _res, next) => {
    const slug = slugFrom(req.hostname);
    const tenant = slug && (await tenants().findBySlug(slug));
    if (!tenant) throw new NotFoundException();

    CURRENT_TENANT.set(tenant);
    next();
  };
}
```

`slugFrom` only accepts a valid subdomain right before your domain: it rejects the root domain (`myapp.com`), foreign domains (`evil.com`), nested subdomains (`a.acme.myapp.com`) and those that start or end with a hyphen.

It's a middleware and not a guard because it has to run **before the authentication guard**, and also on public routes, like login.

Register it in `main.ts`. Middlewares are added before starting, but `app.get()` only works afterwards, so it receives a function that gets the service when each request arrives:

```ts title="src/main.ts"
const app = createApp({ rootModule: AppModule, trustProxy: 1 })
  .enableShutdownHooks()
  .useAuthGuard(AuthGuard);

app.use(tenantMiddleware(() => app.get(TenantsService)));

await app.listen();
```

`TenantsService` has to be visible from the root module, like any provider you ask for with `app.get()`.

This middleware runs on every request, so keep the companies in memory for a few seconds instead of querying the database each time.

## Check the user belongs to the company

This is the key step. Whoever makes the request picks the subdomain: without this check, a user from Acme could enter `globex.myapp.com` with their session and see Globex's data.

If you use [JWT](../jwt-auth/), include the company in the token at login:

```ts
new SignJWT({ tenantId: tenant.id })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(user.id)
  .setExpirationTime('15m')
  .sign(key);
```

And compare it in the authentication guard:

```ts title="src/auth/auth.guard.ts" ins={8}
async canActivate({ req }: HttpContext) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;

  try {
    const { sub, tenantId } = await this.tokens.verify(header.slice('Bearer '.length));
    if (typeof sub !== 'string') return false;
    if (tenantId !== CURRENT_TENANT.get().id) return false;

    CURRENT_USER.set({ id: sub });
    return true;
  } catch {
    return false;
  }
}
```

That way, an Acme token used on `globex.myapp.com` responds 401.

At login, look up the user **within the current company**, not in the whole database, so the same email can exist in two companies without mixing them up.

## Filter every query

Every table with a company's data has a `tenant_id` column, and every query filters by it. Do it in the repositories, reading `CURRENT_TENANT`, so no service has to remember it:

```ts title="src/books/books.repository.ts"
findAll() {
  const { id } = CURRENT_TENANT.get();
  return this.database.db.select().from(books).where(eq(books.tenantId, id));
}

create(title: string) {
  const { id } = CURRENT_TENANT.get();
  return this.database.db.insert(books).values({ title, tenantId: id }).returning();
}
```

Forgetting one filter is enough to mix two companies' data. As a second barrier, PostgreSQL lets you define [row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), which apply the filter in the database itself.

`CURRENT_TENANT.get()` throws if there's no company, instead of returning everyone's data. Outside a request, like in a script or a background job, open a context with [`runInNewContext`](../../core/request-lifecycle/#outside-a-request) and store the company before using the repositories.

## Register a company

The frontend can suggest the slug from the name as the user types, and show how their address will look. But validation belongs to the backend, because a request can be sent without going through your frontend:

```ts title="src/tenants/tenants.schemas.ts"
import { z } from 'zod';

const RESERVED = ['www', 'api', 'admin', 'app', 'mail', 'static', 'status'];

export const CreateTenant = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
    .refine((slug) => !RESERVED.includes(slug)),
});
```

- **The format** is that of a valid subdomain: lowercase letters, numbers and hyphens, with no hyphens at the start or end, and up to 63 characters.
- **Reserved names** keep someone from registering addresses like `admin.myapp.com` or `api.myapp.com`. Add the subdomains you use to the list.
- **Whether it already exists** is something only the database knows: put a `UNIQUE` constraint on the `slug` column, and translate the duplicate key error to a 409 with an [interceptor](../../core/interceptors/#translate-errors).

Keep in mind that the slug is part of the company's address, so changing it later breaks saved links.

## Behind a proxy

With [`trustProxy`](../../security/client-ip/) on, `req.hostname` stops reading the `Host` header and reads `X-Forwarded-Host`: a request to `acme.myapp.com` with `X-Forwarded-Host: globex.myapp.com` is treated as Globex.

Make sure your proxy **overwrites** `X-Forwarded-Host` with the real host, instead of passing along the one the client sends. And it's another reason the membership check is essential: even if someone forges the host, their token still belongs to their company.

## Cookies and CORS

If you use session cookies, don't set the `Domain` attribute on them: that way the browser only sends them to the subdomain that created them, and not to the other companies.

If each company's frontend is on its own subdomain, CORS has to accept those origins. Compare with an exact expression, not a simple `endsWith('myapp.com')`, which would also accept `https://evilmyapp.com`:

```ts
import cors from 'cors';

app.use(cors({ origin: /^https:\/\/[a-z0-9-]+\.myapp\.com$/, credentials: true }));
```

## WebSocket

A WebSocket handshake doesn't go through middlewares, so `CURRENT_TENANT` has no value in it. Identify the company in `authenticate`, from the `Host` header, check the user belongs to it and store it on the connection:

```ts
WebSocketModule.forRoot({
  authenticate: async (req) => {
    const session = await verifySession(req);
    const tenant = await findTenantByHost(req.headers.host);
    if (!session || !tenant || session.tenantId !== tenant.id) return false;
    return { userId: session.userId, tenantId: tenant.id };
  },
}),
```

Then use `client.state.tenantId` in the messages, and add the company to room names, like `` `${tenantId}:general` ``, so two companies don't share a room.
