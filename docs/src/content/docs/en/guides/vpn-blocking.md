---
title: Block VPNs
description: Reject connections from known VPN IP ranges with a local list or an external API, and learn the limits of this detection.
sidebar:
  order: 5
---

Some apps need to limit access from VPNs, for example to curb free-trial abuse or to comply with country restrictions. viga has nothing specific for this, because it can be solved with pieces it already has: a provider that knows which IPs belong to a VPN and a guard that rejects those requests.

:::caution
A request doesn't say it comes from a VPN. All you can do is compare its IP with known ranges, and that fails in both directions:

- **It lets connections through:** no list covers every VPN, providers change IPs and a residential proxy uses the IPs of ordinary homes.
- **It blocks the wrong people:** an IP in those ranges can also belong to a company or to someone using a VPN for privacy.

Use it to reduce abuse, not as a security control. Whatever has to be protected also needs authentication and permissions.
:::

## Choose where the information comes from

| Option | Advantages | Drawbacks |
| --- | --- | --- |
| Local list of ranges | No dependencies or external calls on each request, and the IP doesn't leave your server. | It falls behind between updates. |
| Commercial database, like [GeoIP Anonymous IP](https://www.maxmind.com/en/geoip-anonymous-ip-database) | It's queried locally and has a provider responsible for the data. | It costs money and needs its own reader. |
| External API, like [IPinfo](https://ipinfo.io/proxy-vpn-detection-api) | Data kept up to date by the provider, often with more signals. | It adds latency and a dependency, and sends your users' IPs to a third party. |

If your CDN or proxy already offers this kind of blocking, consider it first: requests are rejected before they reach your app.

This guide builds the first option and then shows how to swap it for an API.

## Before you start: the right IP

Everything depends on `req.ip`. If the app is behind a proxy, set [`trustProxy`](../../security/client-ip/) to the exact number of proxies:

- **Not set**, `req.ip` is your proxy's IP, which isn't on any list, so you'd never block anyone.
- **With `trustProxy: true`**, the client picks its IP with `X-Forwarded-For`, so it can skip the block on every request.

## The list of ranges

The example uses [X4BNet/lists_vpn](https://github.com/X4BNet/lists_vpn), a public list that updates automatically. Its `output/vpn` folder has one range per line, like `2.26.8.0/22`, in one file for IPv4 and another for IPv6. The `output/datacenter` folder adds datacenters, but that would also block legitimate servers, like the ones that send webhooks.

:::note
That repository doesn't declare a license. Check its terms before using it in a product, and keep in mind that whoever maintains a list decides who you block: a range that's too broad can shut out legitimate users.
:::

`BlockList`, from `node:net`, checks whether an IP belongs to any of the ranges, with nothing to install:

```ts title="src/vpn/vpn-list.service.ts"
import { BlockList, isIP } from 'node:net';
import { Injectable, LOGGER, inject, type OnModuleDestroy, type OnModuleInit } from 'viga';

const SOURCE = 'https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn';
const ONE_DAY = 24 * 60 * 60_000;

async function addRanges(list: BlockList, url: string, family: 'ipv4' | 'ipv6') {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);

  const ranges = (await response.text()).split('\n').map((line) => line.trim()).filter(Boolean);
  if (ranges.length === 0) throw new Error(`${url} is empty`);

  for (const range of ranges) {
    const [address, prefix] = range.split('/');
    if (prefix === undefined) list.addAddress(address, family);
    else list.addSubnet(address, Number(prefix), family);
  }
}

@Injectable()
export class VpnListService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = inject(LOGGER);
  private list = new BlockList();
  private timer?: NodeJS.Timeout;

  async onModuleInit() {
    await this.refresh();

    this.timer = setInterval(() => {
      this.refresh().catch((error) => this.logger.error('Could not refresh the VPN list', error));
    }, ONE_DAY);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  isVpn(ip: string | undefined) {
    if (!ip) return false;
    return this.list.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
  }

  private async refresh() {
    const next = new BlockList();
    await addRanges(next, `${SOURCE}/ipv4.txt`, 'ipv4');
    await addRanges(next, `${SOURCE}/ipv6.txt`, 'ipv6');
    this.list = next;
  }
}
```

The new list only replaces the previous one once it has been fully downloaded and read. That way, if an update fails, the app keeps the last good list.

If the first download fails, `onModuleInit` throws the error and the app doesn't start. So that a deployment doesn't depend on an external service, keep a copy of the list in your own storage and download it from there.

`check` goes through the ranges, but it's fast: with about 11,000 it takes around 60 microseconds per call.

## The guard

```ts title="src/vpn/no-vpn.guard.ts"
import { ForbiddenException, Injectable, inject, type CanActivate, type HttpContext } from 'viga';
import { VpnListService } from './vpn-list.service.ts';

@Injectable()
export class NoVpnGuard implements CanActivate {
  private readonly vpn = inject(VpnListService);

  canActivate({ req }: HttpContext) {
    if (this.vpn.isVpn(req.ip)) throw new ForbiddenException('VPN access is not allowed');
    return true;
  }
}
```

Use an exception with a message instead of returning `false`: someone using a VPN with no bad intent understands what they have to do. If the frontend needs to tell this 403 from the others, use [your own code](../../core/exceptions/#your-own-codes-and-messages).

Create a global module for the service. It has to be global so it can also be used in [WebSocket](#websocket):

```ts title="src/vpn/vpn.module.ts"
import { Module } from 'viga';
import { VpnListService } from './vpn-list.service.ts';

@Module({
  providers: [VpnListService],
  exports: [VpnListService],
  global: true,
})
export class VpnModule {}
```

Import it in the root module and put the guard only on the routes that need it:

```ts title="src/auth/auth.controller.ts"
@Public()
@Post('/register')
@UseGuards(NoVpnGuard)
@Validate({ body: Register })
register({ body }: HttpContext<{ body: typeof Register }>) {
  return this.users.register(body);
}
```

## Block the whole app

If you really need to block every route, use a middleware:

```ts title="src/main.ts"
const app = createApp({ rootModule: AppModule, trustProxy: 1 })
  .enableShutdownHooks()
  .useAuthGuard(AuthGuard);

app.use((req, _res, next) => {
  if (app.get(VpnListService).isVpn(req.ip)) {
    throw new ForbiddenException('VPN access is not allowed');
  }
  next();
});

await app.listen();
```

It's better to start with specific routes. A global block also affects public routes and external services that call your API, like payments or webhooks, if their IPs are on the list.

## Measure before blocking

Before rejecting anyone, turn on the guard for a while just to count. That shows you how many legitimate requests would be affected:

```ts
canActivate({ req }: HttpContext) {
  if (this.vpn.isVpn(req.ip)) this.logger.info(`VPN request to ${req.path}`);
  return true;
}
```

Also decide what a legitimate user you block should do, like contacting support or turning off the VPN, and state that way out in the error message.

## With an external API

To use an API, change only the service. Since the check is asynchronous, `canActivate` becomes asynchronous too, with `await this.vpn.isVpn(req.ip)`:

```ts title="src/vpn/vpn-api.service.ts"
import { Injectable, LOGGER, inject } from 'viga';
import { z } from 'zod';

const VpnResponse = z.object({ vpn: z.boolean() });

const ONE_HOUR = 60 * 60_000;
const MAX_ENTRIES = 10_000;

@Injectable()
export class VpnApiService {
  private readonly logger = inject(LOGGER);
  private readonly cache = new Map<string, { vpn: boolean; expiresAt: number }>();

  async isVpn(ip: string | undefined) {
    if (!ip) return false;

    const cached = this.cache.get(ip);
    if (cached && cached.expiresAt > Date.now()) return cached.vpn;

    try {
      const response = await fetch(`https://api.example.com/ip/${encodeURIComponent(ip)}`, {
        headers: { authorization: `Bearer ${process.env.VPN_API_KEY}` },
        signal: AbortSignal.timeout(1_000),
      });
      if (!response.ok) throw new Error(`The VPN API responded ${response.status}`);

      const { vpn } = VpnResponse.parse(await response.json());
      this.remember(ip, vpn);
      return vpn;
    } catch (error) {
      this.logger.error('Could not check the IP', error);
      return false;
    }
  }

  private remember(ip: string, vpn: boolean) {
    this.cache.delete(ip);
    if (this.cache.size >= MAX_ENTRIES) {
      for (const oldest of this.cache.keys()) {
        this.cache.delete(oldest);
        break;
      }
    }
    this.cache.set(ip, { vpn, expiresAt: Date.now() + ONE_HOUR });
  }
}
```

The URL and the `vpn` field are examples: adapt them to your provider. The other decisions apply to any of them:

- **A short timeout:** if the API is slow, it doesn't delay your routes by more than a second.
- **What to do if it fails:** here the request is let through, so a provider outage doesn't block all your users. If blocking matters more than availability, reject the request.
- **A bounded cache:** it avoids a call on every request, and the limit keeps anyone from filling the memory by changing IPs.
- **Only on the routes that need it:** each new IP uses up provider quota, so an attacker could exhaust it. Write a [`@RateLimit()`](../../security/rate-limiting/#per-route) above the guard: among decorators of the same type, the topmost runs first, so a request over the limit never reaches the API.

An IP can be considered personal data. Before sending it to a third party or storing it in logs, check the regulations that apply to your app.

## WebSocket

A WebSocket handshake doesn't go through middlewares or `@UseGuards()`. Check it in `authenticate`, which runs on each connection:

```ts title="src/app.module.ts"
WebSocketModule.forRoot(() => {
  const vpn = inject(VpnListService);
  const clientIp = inject(CLIENT_IP);

  return {
    authenticate: async (req) => {
      if (vpn.isVpn(clientIp(req))) return false;

      return verifySession(req);
    },
  };
}),
```

`authenticate` receives the Node.js request, without `req.ip`. [`CLIENT_IP`](../../security/client-ip/#websocket) returns the same IP as `req.ip`, according to your `trustProxy`.

Returning `false` rejects the connection with a 401. The check only happens on connecting, so an open connection keeps working even if its IP later joins the list.

## Tor and proxies

This list covers VPNs, not every way of hiding an IP. Tor publishes the [list of its exit nodes](https://check.torproject.org/torbulkexitlist), with one IP per line, and `addRanges` can read it too:

```ts
await addRanges(next, 'https://check.torproject.org/torbulkexitlist', 'ipv4');
```

For open and residential proxies, the usual choice is a commercial provider.
