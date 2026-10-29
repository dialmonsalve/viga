---
title: Ciclo de vida de una petición
description: El recorrido completo de una petición en viga, desde que llega hasta la respuesta, los middlewares de Express y el contexto de cada petición.
sidebar:
  order: 7
---

Las páginas anteriores explican cada pieza por separado. Esta muestra cómo encajan: qué le pasa a una petición desde que llega hasta que sale la respuesta, y en qué orden.

## El recorrido

viga procesa cada petición en este orden. Si un paso la rechaza, los siguientes no se ejecutan y viga responde con el error de ese paso:

| Paso | Qué hace | Si rechaza |
| --- | --- | --- |
| 1. Id de la petición | Asigna un id y lo añade a la cabecera `X-Request-Id`. | |
| 2. Cabeceras de seguridad | Añade las cabeceras de seguridad a la respuesta. | |
| 3. Middlewares de Express | Ejecuta los que añadiste con `app.use()`. | Lo que decida cada middleware |
| 4. Comprobación CSRF | Rechaza formularios enviados desde otro sitio. | 403 |
| 5. Autenticación | Ejecuta el [guard de autenticación](../guards/#el-guard-de-autenticación), salvo en rutas `@Public()`. | 401 |
| 6. Lectura del cuerpo | Lee el cuerpo de la petición. | 400 si el JSON está mal formado o la ruta no acepta cuerpo, 413 si es demasiado grande |
| 7. Guards de la ruta | Ejecuta los `@UseGuards()` de la clase y después los del método. | 403, o 429 con `@RateLimit` |
| 8. Interceptores | Entra en los [interceptores](../interceptors/): globales, de la clase y del método. | |
| 9. Validación | Valida los datos con `@Validate`. | 400 |
| 10. Método | Ejecuta el método del controlador. | El error que lance |

Después, el resultado vuelve por los interceptores en orden inverso y viga envía la respuesta, como se explica en [controladores](../controllers/#la-respuesta). Si algo lanza un error en cualquier paso, viga lo convierte en una respuesta de error con el formato de [excepciones](../exceptions/).

Si la ruta no existe, la petición no pasa del paso 4: responde 404, o 401 si la app tiene autenticación y la petición no trae sesión.

### Por qué el cuerpo se lee después de la autenticación

Leer el cuerpo cuesta memoria y tiempo. Como se lee después del paso 5, una petición anónima a una ruta privada recibe 401 sin que el servidor llegue a leerlo, y una ruta que no existe nunca lo lee. Así, quien no está autenticado no puede hacer trabajar al servidor enviando cuerpos grandes a rutas privadas.

Los guards de la ruta sí ven el cuerpo, porque se ejecutan después. Eso permite, por ejemplo, limitar los intentos de inicio de sesión por email.

### El orden no depende de cómo escribas los decoradores

Los decoradores de un método siguen el orden de la tabla aunque los escribas en otro:

```ts
@Post()
@Validate({ body: CreateBook })
@UseGuards(AdminGuard)
create({ body }: HttpContext<{ body: typeof CreateBook }>) {
  return this.books.create(body);
}
```

Aquí `AdminGuard` se ejecuta antes que la validación, aunque esté escrito debajo. Un usuario sin permiso recibe 403 antes de que se valide su cuerpo, así que no puede usar los mensajes de validación para averiguar qué espera la ruta. Entre varios decoradores del mismo tipo, el de más arriba se ejecuta primero.

## Middlewares de Express

viga funciona sobre Express, así que puedes usar cualquier middleware de Express con `app.use()`, antes de `listen()`:

```ts title="src/main.ts"
import cors from 'cors';
import { createApp } from 'viga';
import { AppModule } from './app.module.ts';

const app = createApp({ rootModule: AppModule, globalPrefix: '/api' }).enableShutdownHooks();

app.use(cors({ origin: 'https://mi-frontend.com', credentials: true }));

await app.listen();
```

Los middlewares se ejecutan en el paso 3, para todas las peticiones, incluidas las de rutas que no existen. Eso tiene dos consecuencias:

- **Todavía no hay cuerpo.** `req.body` es `undefined` en un middleware, porque el cuerpo se lee en el paso 6.
- **Todavía no hay autenticación.** No uses un middleware para decidir permisos: para eso están los guards.

Como se ejecutan después de las cabeceras de seguridad, un middleware puede cambiarlas si lo necesitas.

## El contexto de la petición

En [guards](../guards/#comparte-el-usuario-con-el-resto-del-código) usaste `CURRENT_USER` para que cualquier código conozca al usuario sin pasarlo como parámetro. `CURRENT_USER` es una clave de contexto, creada con `createContextKey`:

```ts title="src/auth/current-user.ts"
import { createContextKey } from 'viga';

export const CURRENT_USER = createContextKey<User>('currentUser');
```

Cada petición tiene su propio contexto. Aunque el servidor atienda cientos de peticiones al mismo tiempo, cada una ve solo sus valores. Esto funciona con `AsyncLocalStorage` de Node.js, que sigue a la petición a través de todos los `await`.

Una clave tiene cuatro métodos:

| Método | Qué hace |
| --- | --- |
| `get()` | Devuelve el valor, o lanza un error si no hay. |
| `find()` | Devuelve el valor, o `undefined` si no hay. |
| `set(value)` | Guarda el valor para el resto de la petición. Funciona en middlewares, guards, interceptores, controladores y servicios. |
| `run(value, fn)` | Ejecuta `fn` con ese valor y, al terminar, restaura el anterior. |

Un caso habitual es registrar quién crea o modifica algo, sin que el controlador tenga que pasar el usuario al servicio:

```ts title="src/books/books.service.ts"
import { Injectable } from 'viga';
import { CURRENT_USER } from '../auth/current-user.ts';

@Injectable()
export class BooksService {
  create(data: NewBook) {
    const { id } = CURRENT_USER.get();
    return this.repository.insert({ ...data, createdBy: id, updatedBy: id });
  }
}
```

### El id de la petición

viga guarda el id de cada petición en `REQUEST_ID`, una clave de contexto que ya trae. Úsalo para relacionar tus logs con una petición concreta:

```ts
import { REQUEST_ID } from 'viga';

this.logger.info('Libro creado', { requestId: REQUEST_ID.get(), bookId: book.id });
```

Es el mismo id de la cabecera `X-Request-Id` y del campo `requestId` de las respuestas de error. Se configura con la opción `requestId` de `createApp`:

| Opción | Por defecto | Qué hace |
| --- | --- | --- |
| `header` | `'X-Request-Id'` | La cabecera donde se envía el id. |
| `trustIncoming` | `false` | Reutiliza el id que trae la petición, si tiene un formato seguro. Actívalo solo detrás de un proxy que genere ese id, porque si no, cualquier cliente puede elegir el suyo. |
| `generate` | `randomUUID` | La función que genera los ids. |

Con `requestId: false` no se genera ningún id.

### Fuera de una petición

En un script, una tarea programada o un test no hay petición, así que tampoco hay contexto, y `set()` falla:

```txt
[Context] set("currentUser") can only be called inside a request or inside runInNewContext()
```

`runInNewContext` abre un contexto vacío donde `set()` y `get()` funcionan:

```ts title="scripts/import-books.ts"
import { runInNewContext } from 'viga';

await runInNewContext(async () => {
  CURRENT_USER.set(systemUser);
  await booksService.importFromCsv('books.csv');
});
```

Así, el mismo servicio que usa `CURRENT_USER.get()` en las peticiones funciona también desde un script.
