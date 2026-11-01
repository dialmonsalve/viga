---
title: Security testing checklist
description: What depends on your code and is worth reviewing before an audit or a penetration test, with examples of how to handle it in viga.
sidebar:
  order: 4
---

viga covers some common layers with its [defaults](../defaults/), but many others depend on your code. This list gathers the first things a gray-box security test checks, that is, with real users and roles of your app.

It isn't a complete list: it's a starting point. Go through it before every release to production and before an audit.

## Per-resource authorization

Requiring a session isn't enough: you have to check that the resource belongs to whoever asks for it. If `GET /orders/42` returns order 42 to any authenticated user, a user can see other people's orders by changing the number. This flaw is called IDOR (*insecure direct object reference*) and it's one of the most frequent.

Filter by the current user in the repository, not afterwards:

```ts title="src/orders/orders.repository.ts"
findOwned(id: number) {
  const { id: ownerId } = CURRENT_USER.get();
  return this.database.db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.ownerId, ownerId)),
  });
}
```

If it isn't found, respond 404, not 403. A 403 would confirm that order 42 exists and belongs to someone else.

## Several companies in the same app

In a multi-tenant app, the same flaw shows up between companies: a user from company A mustn't see company B's data. The company identifier the client sends, for example in a header, can never be trusted on its own. Check it in a guard against the authenticated user's tenants, store it in a [context key](../../core/request-lifecycle/#the-request-context) and filter every query by it.

## Mass assignment

If you save the request body as is, a client can add fields you didn't expect, like `"role": "admin"` or `"ownerId": 7`. Validate every body with [`@Validate`](../../optional/validation/#extra-fields-are-dropped) and use the validated value: fields that aren't in the schema are dropped. If you'd rather reject them, use a strict object from your schema library, like `z.strictObject()` in Zod or `v.strictObject()` in Valibot.

`requireValidation` already rejects the body on routes that don't validate it, but it can't know whether your schema includes a field it shouldn't.

## Roles and permissions

Put the role guard on the controller with [`@UseGuards()`](../../core/guards/#per-route-guards), not on each method. That way a new route isn't left open by accident. Also review the list of public routes viga logs at startup at `debug` level: it's everything anyone can call without authenticating.

## Brute force

Limit login, sign-up, password recovery and code verification with [`@RateLimit()`](../rate-limiting/#per-route). For login, a key by IP and email slows down someone trying many passwords for the same account.

Make sure [`trustProxy`](../client-ip/) matches the proxies in front of you. Otherwise the limit applies to the proxy's IP, or an attacker can change IP on every request.

## Error messages

Don't tell "the user doesn't exist" apart from "the password is wrong": always respond with `UnauthorizedException()`. If you tell them apart, an attacker can find out which emails are registered. The same goes for password recovery: respond the same whether or not the account exists.

Unexpected errors already respond with a generic message, but check that your own exceptions don't include internal details, like table names or the database's original message.

## CORS

Configure CORS with an explicit list of origins. Never combine `origin: '*'` with `credentials: true`: it would let any site make requests with your users' cookies.

## CSRF

If you authenticate with cookies, keep [CSRF protection](../defaults/#csrf-protection) on and never change data on a `GET` route: it isn't checked, because a link or an image can trigger it.

## WebSocket

If you use [`viga/websocket`](../../optional/websocket/), check three things:

- **`allowedOrigins`** holds only your sites, so another page can't open a WebSocket with your users' cookies.
- **Sessions expire**: return `expiresAt` from `authenticate` so an open connection doesn't keep working with a session that has already expired.
- **Every event that receives data has a schema** in `@OnMessage`.

## Secrets and configuration

- Validate the environment variables with [`viga/config`](../../optional/config/), so an incomplete configuration stops the app from starting instead of failing later.
- Don't commit the `.env` file.
- In production, connect to the database with verified TLS. [`viga/drizzle`](../../optional/drizzle/#tls) warns at startup if that's not the case.

## Dependencies

Check your dependencies for known vulnerabilities regularly, for example with your package manager's `audit` command (`pnpm audit`, `npm audit`...) or your repository host's tool, and keep them up to date.
