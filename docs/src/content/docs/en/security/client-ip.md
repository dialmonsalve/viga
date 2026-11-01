---
title: Client IP and proxies
description: How viga gets the client's real IP when the app runs behind a proxy or a load balancer, and how to set trustProxy so it can't be forged.
sidebar:
  order: 3
---

viga uses the client's IP in several places: [rate limiting](../rate-limiting/), the per-client connection limit of [WebSocket](../../optional/websocket/#default-limits) and `req.ip` in your controllers. If that IP is wrong, those limits apply to the wrong client. This page explains how to get it right.

## The problem

In production, your app almost never receives requests directly. In front there's usually a proxy or a load balancer: nginx, Cloudflare, your provider's load balancer or a Kubernetes *ingress*. To the app, every request comes from that proxy's IP.

So the original IP isn't lost, each proxy appends it to the end of the `X-Forwarded-For` header. With a single proxy in front, the request arrives like this:

```txt
X-Forwarded-For: 203.0.113.7
```

But anyone can write that header. A client can send its own `X-Forwarded-For` with a made-up IP, and the proxy appends the real one at the end:

```txt
X-Forwarded-For: 6.6.6.6, 203.0.113.7
```

`6.6.6.6` was written by the client; `203.0.113.7` was added by your proxy. Only the second one can be trusted. To know which one is right, viga needs to know how many of your proxies are in front.

## `trustProxy`

`trustProxy` tells viga which proxies to trust. It's passed to `createApp`:

```ts title="src/main.ts"
const app = createApp({ rootModule: AppModule, trustProxy: 1 });
```

With the header `X-Forwarded-For: 6.6.6.6, 203.0.113.7`, each value gives a different IP:

| `trustProxy` | Client IP | When to use it |
| --- | --- | --- |
| Unset (default) | The proxy's | When the app receives requests directly, with no proxy at all. |
| `1` | `203.0.113.7` | With one proxy in front. It's the most common case. |
| `2` | `6.6.6.6` | With two proxies in front, for example Cloudflare and then nginx. With only one real proxy, it takes the made-up IP. |
| Addresses, like `'loopback'` or `['10.0.0.0/8']` | `203.0.113.7` if the proxy is on those networks | When you know your proxies' addresses. It's the strictest option. |
| `true` | `6.6.6.6` | Never. It takes the first value, which the client controls. |

The number has to match exactly the proxies in front: if you set more than you have, viga takes an IP the client wrote.

### Why not `trustProxy: true`

With `true`, viga trusts every `X-Forwarded-For` and takes the first value, which is the one the client writes. Anyone could change their IP on every request and bypass rate limiting. That's why, if you use it, viga logs a warning at startup:

```txt
[App] trustProxy: true takes the client IP from the first X-Forwarded-For value, which the client can forge to bypass rate limits; use the number of proxies in front of the app (for example 1) or their addresses
```

## How to find out how many proxies you have

If you're not sure, create a temporary route that shows what arrives and call it from your browser in production:

```ts
@Public()
@Get('/debug/ip')
ip({ req }: HttpContext) {
  return { ip: req.ip, forwardedFor: req.headers['x-forwarded-for'] };
}
```

Count the IPs in `forwardedFor`: with one proxy you'll see one, yours; with two, you'll see two. Adjust `trustProxy` until `ip` is your public IP, and then **delete the route**.

## If the app is also reachable directly

`trustProxy: 1` trusts the last hop of `X-Forwarded-For`, whoever sends it. If your app also accepts direct connections, without going through the proxy, an attacker can connect directly and send their own `X-Forwarded-For` with a single made-up IP, and viga would take it as genuine.

To prevent it, do one of these two things:

- **Close direct access**, with a firewall or a private network, so only the proxy can reach the app. This is the recommended option.
- **Trust by address instead of by number**, with your proxy's networks: `trustProxy: ['10.0.0.0/8']`. That way viga only reads `X-Forwarded-For` when the request really comes from those networks.

## WebSocket

WebSocket's per-client connection limit uses the same IP and the same `trustProxy`. If a handshake carries `X-Forwarded-For` but `trustProxy` doesn't trust its sender, viga logs a warning once: every client behind that proxy would share a single counter, and that limit would block them all at once.

`trustProxy` accepts the same values as Express's `trust proxy` option, because viga passes it as is.
