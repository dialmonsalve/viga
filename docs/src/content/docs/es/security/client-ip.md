---
title: IP del cliente y proxies
description: Cómo obtiene viga la IP real del cliente cuando la app está detrás de un proxy o un balanceador, y cómo configurar trustProxy sin que se pueda falsificar.
sidebar:
  order: 3
---

viga usa la IP del cliente en varios sitios: el [límite de peticiones](../rate-limiting/), el límite de conexiones por cliente de [WebSocket](../../optional/websocket/#límites-por-defecto) y `req.ip` en tus controladores. Si esa IP es incorrecta, esos límites se aplican a quien no deben. Esta página explica cómo obtenerla bien.

## El problema

En producción, tu app casi nunca recibe las peticiones directamente. Delante suele haber un proxy o un balanceador: nginx, Cloudflare, el balanceador de tu proveedor o el *ingress* de Kubernetes. Para la app, todas las peticiones vienen de la IP de ese proxy.

Para no perder la IP original, cada proxy la añade al final de la cabecera `X-Forwarded-For`. Con un solo proxy delante, la petición llega así:

```txt
X-Forwarded-For: 203.0.113.7
```

Pero esa cabecera la puede escribir cualquiera. Un cliente puede enviar su propio `X-Forwarded-For` con una IP inventada, y el proxy añade la real al final:

```txt
X-Forwarded-For: 6.6.6.6, 203.0.113.7
```

`6.6.6.6` la puso el cliente; `203.0.113.7` la añadió tu proxy. Solo la segunda es de fiar. Para saber cuál es la buena, viga necesita saber cuántos proxies tuyos hay delante.

## `trustProxy`

`trustProxy` le dice a viga en qué proxies confiar. Se pasa a `createApp`:

```ts title="src/main.ts"
const app = createApp({ rootModule: AppModule, trustProxy: 1 });
```

Con la cabecera `X-Forwarded-For: 6.6.6.6, 203.0.113.7`, cada valor da una IP distinta:

| `trustProxy` | IP del cliente | Cuándo usarlo |
| --- | --- | --- |
| Sin definir (por defecto) | La del proxy | Cuando la app recibe las peticiones directamente, sin ningún proxy. |
| `1` | `203.0.113.7` | Con un proxy delante. Es lo más habitual. |
| `2` | `6.6.6.6` | Con dos proxies delante, por ejemplo Cloudflare y después nginx. Con un solo proxy real, toma la IP inventada. |
| Direcciones, como `'loopback'` o `['10.0.0.0/8']` | `203.0.113.7` si el proxy está en esas redes | Cuando conoces las direcciones de tus proxies. Es lo más estricto. |
| `true` | `6.6.6.6` | Nunca. Toma el primer valor, que el cliente controla. |

El número tiene que coincidir exactamente con los proxies que hay delante: si pones más de los que tienes, viga toma una IP que puso el cliente.

### Por qué no `trustProxy: true`

Con `true`, viga confía en todo `X-Forwarded-For` y toma el primer valor, que es el que escribe el cliente. Cualquiera podría cambiar de IP en cada petición y saltarse el límite de peticiones. Por eso, si lo usas, viga muestra un aviso al arrancar:

```txt
[App] trustProxy: true takes the client IP from the first X-Forwarded-For value, which the client can forge to bypass rate limits; use the number of proxies in front of the app (for example 1) or their addresses
```

## Cómo saber cuántos proxies tienes

Si no estás seguro, crea una ruta temporal que muestre lo que llega y llámala desde tu navegador en producción:

```ts
@Public()
@Get('/debug/ip')
ip({ req }: HttpContext) {
  return { ip: req.ip, forwardedFor: req.headers['x-forwarded-for'] };
}
```

Cuenta las IPs de `forwardedFor`: con un proxy verás una, la tuya; con dos, verás dos. Ajusta `trustProxy` hasta que `ip` sea tu IP pública y después **borra la ruta**.

## Si la app también es accesible directamente

`trustProxy: 1` confía en el último salto de `X-Forwarded-For`, sea quien sea quien lo envía. Si tu app también acepta conexiones directas, sin pasar por el proxy, un atacante puede conectarse directamente y enviar su propio `X-Forwarded-For` con una sola IP inventada, y viga la tomaría como buena.

Para evitarlo, haz una de estas dos cosas:

- **Cierra el acceso directo**, con un firewall o una red privada, para que solo el proxy pueda llegar a la app. Es lo recomendable.
- **Confía por direcciones en lugar de por número**, con las redes de tu proxy: `trustProxy: ['10.0.0.0/8']`. Así viga solo lee `X-Forwarded-For` cuando la petición viene realmente de esas redes.

## WebSocket

El límite de conexiones por cliente de WebSocket usa la misma IP y el mismo `trustProxy`. Si un handshake trae `X-Forwarded-For` pero `trustProxy` no confía en quien lo envía, viga muestra un aviso una vez: todos los clientes detrás de ese proxy compartirían un único contador, y ese límite los bloquearía a todos a la vez.

`trustProxy` acepta los mismos valores que la opción `trust proxy` de Express, porque viga se la pasa tal cual.
