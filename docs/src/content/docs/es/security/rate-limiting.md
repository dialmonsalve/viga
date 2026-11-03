---
title: Límite de peticiones
description: Limita cuántas peticiones puede hacer un cliente en un tiempo, para toda la app o por ruta, y cómo elegir la clave y el almacén del contador.
sidebar:
  order: 2
---

Un límite de peticiones cuenta cuántas peticiones hace cada cliente en una ventana de tiempo y, si pasa del máximo, responde 429 hasta que la ventana termina. Sirve para frenar ataques de fuerza bruta contra el inicio de sesión, el abuso de rutas costosas o los scripts que llaman a tu API sin parar.

En HTTP viene **desactivado**: tú decides dónde ponerlo. No se activa solo porque, detrás de un proxy mal configurado, todos los usuarios compartirían la IP del proxy y quedarían bloqueados a la vez. Lee [IP del cliente y proxies](../client-ip/) antes de activarlo. En WebSocket sí hay un límite por conexión activado por defecto, como se explica en [`@vigajs/websocket`](../../optional/websocket/#límites-por-defecto).

## Para toda la app

`rateLimit()` es un middleware que limita todas las peticiones de cada cliente:

```ts title="src/main.ts"
import { createApp, rateLimit } from '@vigajs/core';

const app = createApp({ rootModule: AppModule }).enableShutdownHooks();
app.use(rateLimit({ max: 300, windowMs: 60_000 }));
```

Aquí cada IP puede hacer 300 peticiones por minuto, sumando todas las rutas.

## Por ruta

`@RateLimit()` pone un límite propio a una ruta, o a todas las de un controlador si lo pones sobre la clase. Es lo adecuado para las rutas sensibles, como el inicio de sesión:

```ts title="src/auth/auth.controller.ts"
import { Controller, Post, Public, RateLimit, type HttpContext } from '@vigajs/core';
import { Validate } from '@vigajs/validation';
import { z } from 'zod';

const Login = z.object({ email: z.email(), password: z.string() });

@Public()
@Controller('/auth')
export class AuthController {
  @Post('/login')
  @RateLimit({ max: 5, windowMs: 15 * 60_000 })
  @Validate({ body: Login })
  login({ body }: HttpContext<{ body: typeof Login }>) {
    return this.auth.login(body);
  }
}
```

Cada límite tiene su propio contador. Si la app tiene un límite global y una ruta tiene el suyo, una petición a esa ruta cuenta en los dos.

`@RateLimit()` es un guard, así que se ejecuta con los demás [guards de la ruta](../../core/guards/#el-orden-en-que-se-ejecutan), antes de la validación y del método.

## La respuesta

Cada respuesta lleva tres cabeceras con el estado del contador:

| Cabecera | Qué indica |
| --- | --- |
| `RateLimit-Limit` | El máximo de peticiones de la ventana. |
| `RateLimit-Remaining` | Cuántas quedan. |
| `RateLimit-Reset` | Cuántos segundos faltan para que la ventana se reinicie. |

Cuando el cliente pasa del máximo, la respuesta es un 429 con el código `errors.tooManyRequests` y la cabecera `Retry-After`, que dice cuántos segundos esperar.

## La clave del contador

El contador se lleva por clave: dos peticiones con la misma clave suman al mismo contador. Por defecto, la clave es la IP del cliente, normalizada con `ipKey()`:

- Una dirección IPv4 escrita como IPv6, como `::ffff:1.2.3.4`, cuenta como su IPv4, `1.2.3.4`.
- Una dirección IPv6 cuenta como su red `/56`. Quien controla una dirección IPv6 suele controlar todo el bloque, y sin esto podría conseguir un contador nuevo con cada dirección.

### Una clave propia

La opción `key` recibe la petición y devuelve la clave. Para el inicio de sesión, limitar por IP y por email a la vez frena a quien prueba muchas contraseñas para una misma cuenta, sin bloquear a otros usuarios de la misma red:

```ts
import { RateLimit, ipKey } from '@vigajs/core';

@RateLimit({
  max: 5,
  windowMs: 15 * 60_000,
  key: (req) => `${ipKey(req.ip ?? '')}:${req.body?.email}`,
})
```

Usa `ipKey()` siempre que construyas una clave a partir de la IP, para que las direcciones IPv6 se agrupen igual que en la clave por defecto. `ipKey(address, 64)` agrupa por otra longitud de red.

La clave puede usar el cuerpo porque `@RateLimit()` se ejecuta después de leerlo. Pero todavía no está validado: trátalo como datos que vienen del cliente. Las claves de más de 128 caracteres se guardan como un hash, así que un valor enorme no ocupa más memoria.

## Dónde se guarda el contador

Por defecto, el contador vive en la memoria del proceso, en un `MemoryRateLimitStore`. Para que no pueda agotar la memoria:

- Guarda como máximo 10.000 claves. Puedes cambiarlo con `new MemoryRateLimitStore({ maxKeys })`, que se pasa en la opción `store`.
- Cuando está lleno, descarta primero la clave más antigua vista una sola vez. Así, una avalancha de claves nuevas, por ejemplo con emails inventados, no puede borrar el contador de una clave que está siendo atacada.
- Si todas las claves guardadas están activas y repetidas, trata una clave nueva como si ya hubiera superado el límite hasta que alguna caduque: ante la duda, rechaza en lugar de dejar pasar. Si el tráfico legítimo puede llenarlo, sube `maxKeys`.

### Varias instancias

El contador en memoria es de cada proceso. Si tu app corre en varias instancias, cada una cuenta por su lado y el límite real se multiplica por el número de instancias. Para compartir el contador, implementa la interfaz `RateLimitStore` sobre Redis u otro almacén compartido y pásala en `store`:

```ts
import type { RateLimitHit, RateLimitStore } from '@vigajs/core';

export class SharedRateLimitStore implements RateLimitStore {
  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    ...
  }
}
```

`hit` suma una petición a la clave y devuelve cuántas lleva (`count`) y cuándo se reinicia la ventana (`resetAt`, en milisegundos desde 1970). Con Redis, lo habitual es un `INCR` de la clave y, si es la primera petición, un `PEXPIRE` con la duración de la ventana, los dos en una misma transacción.

## Ventana fija

La ventana es fija: empieza con la primera petición y dura `windowMs`. Un cliente puede hacer `max` peticiones al final de una ventana y otras `max` al principio de la siguiente, así que en poco tiempo puede llegar al doble. Elige `max` teniendo en cuenta esa ráfaga.

## En WebSocket

Para limitar eventos de un gateway, usa el `RateLimit` que se importa de `@vigajs/websocket`, no el de `@vigajs/core`. Se explica en [`@vigajs/websocket`](../../optional/websocket/#guards-interceptores-y-límites-por-evento).
