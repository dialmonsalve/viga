---
title: Bloquear VPN
description: Rechaza conexiones desde rangos de IP conocidos de VPN con una lista local o una API externa, y conoce los límites de esta detección.
sidebar:
  order: 5
---

Algunas apps necesitan limitar el acceso desde VPN, por ejemplo para frenar el abuso de pruebas gratuitas o cumplir restricciones por país. viga no trae nada específico para esto, porque se resuelve con piezas que ya tiene: un provider que sabe qué IP son de una VPN y un guard que rechaza esas peticiones.

:::caution
Una petición no indica que venga de una VPN. Lo único que puedes hacer es comparar su IP con rangos conocidos, y eso falla en los dos sentidos:

- **Deja pasar conexiones:** ninguna lista cubre todas las VPN, los proveedores cambian de IP y un proxy residencial usa IP de hogares corrientes.
- **Bloquea a quien no debe:** una IP de esos rangos también puede ser de una empresa o de alguien que usa una VPN por privacidad.

Úsalo para reducir el abuso, no como control de seguridad. Lo que tenga que estar protegido necesita también autenticación y permisos.
:::

## Elige de dónde sale la información

| Opción | Ventajas | Inconvenientes |
| --- | --- | --- |
| Lista local de rangos | Sin dependencias ni llamadas externas en cada petición, y la IP no sale de tu servidor. | Se queda atrás entre actualizaciones. |
| Base de datos comercial, como [GeoIP Anonymous IP](https://www.maxmind.com/en/geoip-anonymous-ip-database) | Se consulta en local y tiene un proveedor responsable de los datos. | Tiene coste y requiere su propio lector. |
| API externa, como [IPinfo](https://ipinfo.io/proxy-vpn-detection-api) | Datos actualizados por el proveedor, a menudo con más señales. | Añade latencia y una dependencia, y envía la IP de tus usuarios a un tercero. |

Si tu CDN o tu proxy ya ofrece este bloqueo, considéralo primero: las peticiones se rechazan antes de llegar a tu app.

Esta guía construye la primera opción y después muestra cómo cambiarla por una API.

## Antes de empezar: la IP correcta

Todo depende de `req.ip`. Si la app está detrás de un proxy, configura [`trustProxy`](../../security/client-ip/) con el número exacto de proxies:

- **Sin configurar**, `req.ip` es la IP de tu proxy, que no está en ninguna lista, así que nunca bloquearías a nadie.
- **Con `trustProxy: true`**, el cliente elige su IP con `X-Forwarded-For`, así que puede saltarse el bloqueo en cada petición.

## La lista de rangos

El ejemplo usa [X4BNet/lists_vpn](https://github.com/X4BNet/lists_vpn), una lista pública que se actualiza automáticamente. Su carpeta `output/vpn` contiene un rango por línea, como `2.26.8.0/22`, en un archivo para IPv4 y otro para IPv6. La carpeta `output/datacenter` añade los centros de datos, pero eso también bloquearía servidores legítimos, como los que envían webhooks.

:::note
Ese repositorio no declara ninguna licencia. Revisa sus condiciones antes de usarlo en un producto, y considera que quien mantiene una lista decide a quién bloqueas: un rango demasiado amplio puede dejar fuera a usuarios legítimos.
:::

`BlockList`, de `node:net`, comprueba si una IP pertenece a alguno de los rangos, sin instalar nada:

```ts title="src/vpn/vpn-list.service.ts"
import { BlockList, isIP } from 'node:net';
import { Injectable, LOGGER, inject, type OnModuleDestroy, type OnModuleInit } from '@vigajs/core';

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

La lista nueva solo sustituye a la anterior cuando se ha descargado y leído entera. Así, si una actualización falla, la app sigue con la última lista buena.

Si la primera descarga falla, `onModuleInit` lanza el error y la app no arranca. Para que un despliegue no dependa de un servicio externo, guarda una copia de la lista en tu propio almacenamiento y descárgala de allí.

`check` recorre los rangos, pero es rápido: con unos 11 000 tarda alrededor de 60 microsegundos por llamada.

## El guard

```ts title="src/vpn/no-vpn.guard.ts"
import { ForbiddenException, Injectable, inject, type CanActivate, type HttpContext } from '@vigajs/core';
import { VpnListService } from './vpn-list.service.ts';

@Injectable()
export class NoVpnGuard implements CanActivate {
  private readonly vpn = inject(VpnListService);

  canActivate({ req }: HttpContext) {
    if (this.vpn.isVpn(req.ip)) throw new ForbiddenException('No se permite el acceso desde una VPN');
    return true;
  }
}
```

Usa una excepción con un mensaje en lugar de devolver `false`: quien use una VPN sin mala intención entiende qué tiene que hacer. Si el frontend necesita distinguir este 403 de los demás, usa un [código propio](../../core/exceptions/#tus-propios-códigos-y-mensajes).

Crea un módulo global para el servicio. Hace falta que sea global para usarlo también en [WebSocket](#websocket):

```ts title="src/vpn/vpn.module.ts"
import { Module } from '@vigajs/core';
import { VpnListService } from './vpn-list.service.ts';

@Module({
  providers: [VpnListService],
  exports: [VpnListService],
  global: true,
})
export class VpnModule {}
```

Impórtalo en el módulo raíz y pon el guard solo en las rutas que lo necesiten:

```ts title="src/auth/auth.controller.ts"
@Public()
@Post('/register')
@UseGuards(NoVpnGuard)
@Validate({ body: Register })
register({ body }: HttpContext<{ body: typeof Register }>) {
  return this.users.register(body);
}
```

## Bloquear toda la app

Si de verdad necesitas bloquear todas las rutas, usa un middleware:

```ts title="src/main.ts"
const app = createApp({ rootModule: AppModule, trustProxy: 1 })
  .enableShutdownHooks()
  .useAuthGuard(AuthGuard);

app.use((req, _res, next) => {
  if (app.get(VpnListService).isVpn(req.ip)) {
    throw new ForbiddenException('No se permite el acceso desde una VPN');
  }
  next();
});

await app.listen();
```

Empieza mejor por las rutas concretas. Un bloqueo global también afecta a las rutas públicas y a los servicios externos que llaman a tu API, como pagos o webhooks, si sus IP aparecen en la lista.

## Mide antes de bloquear

Antes de rechazar a nadie, activa el guard un tiempo solo para contar. Así ves cuántas peticiones legítimas se verían afectadas:

```ts
canActivate({ req }: HttpContext) {
  if (this.vpn.isVpn(req.ip)) this.logger.info(`VPN request to ${req.path}`);
  return true;
}
```

Decide también qué hará un usuario legítimo al que bloquees, como contactar con soporte o desactivar la VPN, y di esa salida en el mensaje de error.

## Con una API externa

Para usar una API, cambia solo el servicio. Como la comprobación es asíncrona, `canActivate` también pasa a serlo, con `await this.vpn.isVpn(req.ip)`:

```ts title="src/vpn/vpn-api.service.ts"
import { Injectable, LOGGER, inject } from '@vigajs/core';
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

La URL y el campo `vpn` son de ejemplo: adáptalos a tu proveedor. Las demás decisiones valen para cualquiera:

- **Un tiempo máximo corto:** si la API tarda, no retrasa tus rutas más de un segundo.
- **Qué hacer si falla:** aquí se deja pasar la petición, para que una caída del proveedor no bloquee a todos tus usuarios. Si el bloqueo es más importante que la disponibilidad, rechaza la petición.
- **Una caché con límite:** evita una llamada en cada petición, y el límite impide que alguien llene la memoria cambiando de IP.
- **Solo en las rutas necesarias:** cada IP nueva gasta cuota del proveedor, así que un atacante podría agotarla. Escribe un [`@RateLimit()`](../../security/rate-limiting/#por-ruta) encima del guard: entre decoradores del mismo tipo, el de más arriba se ejecuta primero, así que una petición que supere el límite no llega a llamar a la API.

Una IP puede considerarse un dato personal. Antes de enviarla a un tercero o guardarla en los logs, revisa la normativa que se aplica a tu app.

## WebSocket

El handshake de un WebSocket no pasa por los middlewares ni por `@UseGuards()`. Compruébalo en `authenticate`, que se ejecuta en cada conexión:

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

`authenticate` recibe la petición de Node.js, sin `req.ip`. [`CLIENT_IP`](../../security/client-ip/#websocket) devuelve la misma IP que `req.ip`, según tu `trustProxy`.

Devolver `false` rechaza la conexión con 401. La comprobación solo ocurre al conectarse, así que una conexión ya abierta sigue funcionando aunque su IP entre después en la lista.

## Tor y proxies

Esta lista cubre VPN, no toda forma de ocultar la IP. Tor publica la [lista de sus nodos de salida](https://check.torproject.org/torbulkexitlist), con una IP por línea, y `addRanges` también puede leerla:

```ts
await addRanges(next, 'https://check.torproject.org/torbulkexitlist', 'ipv4');
```

Para los proxies abiertos y residenciales, lo habitual es recurrir a un proveedor comercial.
