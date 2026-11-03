---
title: Interceptores
description: Cómo ejecutar código antes y después de cada método del controlador para medir tiempos, transformar respuestas, cachear o traducir errores.
sidebar:
  order: 5
---

Un interceptor envuelve la ejecución de un método del controlador. Puede hacer algo antes, llamar al método y hacer algo después con el resultado.

Sirve para lo que se repite en muchas rutas y no es lógica de negocio:

- **Medir tiempos**, para encontrar las rutas lentas.
- **Registrar actividad**, por ejemplo quién borró qué y cuándo, sin tocar cada método.
- **Dar el mismo formato a todas las respuestas**, como `{ data: ... }`.
- **Cachear** respuestas que casi nunca cambian.
- **Traducir errores**, como un registro duplicado en la base de datos que debe llegar como 409 y no como 500.
- **Añadir cabeceras**, como `Cache-Control` en las rutas públicas.

Sin interceptores, cada método tendría su propio `try/catch`, su medición y su formato, todos copiados. Con uno, lo escribes una vez y lo aplicas donde haga falta.

## Tu primer interceptor

Un interceptor es una clase con un método `intercept`, que recibe el contexto de la petición y una función `next`. `next()` ejecuta el método del controlador y devuelve una promesa con su resultado:

```ts title="src/common/timing.interceptor.ts"
import { Injectable, type CallHandler, type HttpContext, type Interceptor } from 'viga';

@Injectable()
export class TimingInterceptor implements Interceptor {
  async intercept({ res }: HttpContext, next: CallHandler) {
    const start = performance.now();
    const result = await next();
    res.setHeader('Server-Timing', `app;dur=${(performance.now() - start).toFixed(1)}`);
    return result;
  }
}
```

Lo que devuelve `intercept` es lo que viga envía como respuesta. Aquí devuelve el mismo resultado sin cambiarlo y solo añade una cabecera.

## Dónde se aplican

Igual que los guards, los interceptores se aplican a una ruta, a un controlador o a toda la app:

```ts title="src/books/books.controller.ts"
@UseInterceptors(TimingInterceptor)
@Controller('/books')
export class BooksController {
  @UseInterceptors(AuditInterceptor)
  @Delete('/:id')
  remove({ params }: HttpContext) {
    this.books.remove(Number(params.id));
  }
}
```

```ts title="src/main.ts"
const app = createApp({ rootModule: AppModule, globalPrefix: '/api' })
  .enableShutdownHooks()
  .useAuthGuard(AuthGuard)
  .useGlobalInterceptors(TimingInterceptor);
```

Como los guards, un interceptor de clase puede usar `inject()` y no hace falta declararlo en `providers`. Los de `@UseInterceptors()` se crean con el contenedor del módulo del controlador, y los globales con el del módulo raíz. Si no necesita providers, puede ser una función con la misma firma: `(ctx, next) => ...`.

## Transforma la respuesta

Como el interceptor decide qué se devuelve, puede cambiar el resultado. Este envuelve todas las respuestas en un objeto `data`:

```ts title="src/common/envelope.interceptor.ts"
import { Injectable, type CallHandler, type HttpContext, type Interceptor } from 'viga';

@Injectable()
export class EnvelopeInterceptor implements Interceptor {
  async intercept(_ctx: HttpContext, next: CallHandler) {
    return { data: await next() };
  }
}
```

Con este interceptor, una ruta que devuelve `[{ id: 1 }]` responde `{ "data": [{ "id": 1 }] }`.

:::caution
El código de estado se calcula con lo que devuelve el interceptor, no con lo que devolvió el método. Si `remove()` no devuelve nada, respondería 204; con `EnvelopeInterceptor`, el resultado pasa a ser `{ data: undefined }` y la respuesta es 200 con el cuerpo `{}`. Si quieres conservar el 204, devuelve `undefined` cuando el método no devolvió nada.
:::

## Responde sin llamar al método

Si el interceptor no llama a `next()`, el método no se ejecuta y la respuesta es lo que devuelva el interceptor. Es la base de una caché:

```ts title="src/common/cache.interceptor.ts"
import { Injectable, inject, type CallHandler, type HttpContext, type Interceptor } from 'viga';
import { CacheService } from './cache.service.ts';

@Injectable()
export class CacheInterceptor implements Interceptor {
  private readonly cache = inject(CacheService);

  async intercept({ req }: HttpContext, next: CallHandler) {
    const cached = this.cache.get(req.originalUrl);
    if (cached !== undefined) return cached;

    const result = await next();
    this.cache.set(req.originalUrl, result);
    return result;
  }
}
```

Esto es seguro respecto a los permisos: viga ejecuta todos los guards antes que cualquier interceptor, así que una respuesta cacheada nunca llega a alguien que no pasó la autenticación o los guards de la ruta.

:::caution
Esta caché usa solo la URL como clave, así que sirve la misma respuesta a todos los usuarios. Úsala solo en rutas cuya respuesta no depende de quién la pide. En una ruta como `/books/mine`, el segundo usuario recibiría los libros del primero: incluye el id del usuario en la clave, por ejemplo `` `${CURRENT_USER.get().id}:${req.originalUrl}` ``, o no la caches.
:::

`next()` solo se puede llamar una vez. Si lo llamas dos veces, la petición falla con un error 500 y el log lo explica.

## Traduce errores

Si el método lanza un error, `await next()` lo lanza dentro del interceptor, así que puedes capturarlo y convertirlo en una respuesta HTTP:

```ts title="src/common/database-errors.interceptor.ts"
import { ConflictException, Injectable, type CallHandler, type HttpContext, type Interceptor } from 'viga';

@Injectable()
export class DatabaseErrorsInterceptor implements Interceptor {
  async intercept(_ctx: HttpContext, next: CallHandler) {
    try {
      return await next();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException();
      throw error;
    }
  }
}
```

`isUniqueViolation` es una función tuya que reconoce el error de clave duplicada de tu base de datos. Así, un registro duplicado responde 409 en lugar de 500, sin un `try/catch` en cada servicio. Vuelve a lanzar los errores que no reconoces para que viga los maneje como siempre.

Las excepciones de viga, como `NotFoundException`, también pasan por los interceptores. Un interceptor que transforma la respuesta, como `EnvelopeInterceptor`, no las toca: como `await next()` lanza, el `return { data: ... }` nunca se ejecuta.

## El orden en que se ejecutan

Para cada petición, viga ejecuta primero todos los guards y después los interceptores, de fuera hacia dentro:

1. Los interceptores globales.
2. Los de `@UseInterceptors()` sobre la clase.
3. Los de `@UseInterceptors()` sobre el método.
4. La validación de `@Validate` y el método del controlador.

A la vuelta recorren el camino inverso: el interceptor del método recibe el resultado primero y el global, el último. Entre varios del mismo nivel, el primero de la lista es el más externo.

Si un guard rechaza la petición, ningún interceptor se ejecuta.

:::note
Los interceptores se ejecutan antes que `@Validate`, así que `ctx.body`, `ctx.params` y `ctx.query` todavía tienen los datos sin validar ni convertir. Si un interceptor necesita leerlos, trátalos como datos que vienen del cliente. El método del controlador sí recibe los datos validados.
:::

## Guards o interceptores

Las dos herramientas se ejecutan alrededor de una ruta, pero responden a preguntas distintas:

- **Un guard** decide si la petición puede continuar. Devuelve `true` o `false`, y no ve la respuesta.
- **Un interceptor** envuelve la ejecución. Ve el resultado y el error, y puede cambiarlos.

Comprobar permisos va en un guard. Medir, registrar, transformar o cachear va en un interceptor.
