---
title: Ciclo de vida de la app
description: Cómo arranca y se detiene una app de viga, los hooks de los providers y el cierre ordenado al recibir una señal.
sidebar:
  order: 8
---

Una app de viga pasa por tres etapas: arranca, atiende peticiones y se detiene. Esta página explica qué pasa al arrancar y al detenerse, y cómo un provider puede ejecutar código en esos momentos, por ejemplo para conectarse a una base de datos y cerrar la conexión al final.

## Arrancar

`listen()` arranca la app y empieza a escuchar:

```ts title="src/main.ts"
const app = createApp({ rootModule: AppModule, globalPrefix: '/api' }).enableShutdownHooks();

await app.listen();
```

Al llamarlo, viga:

1. Carga los módulos y crea todos los providers.
2. Ejecuta el hook `onModuleInit` de cada provider que lo tenga.
3. Registra las rutas de los controladores.
4. Ejecuta los hooks `onServerListen`.
5. Empieza a escuchar en el puerto.

Si algo falla en los pasos 1 a 4, la app no llega a abrir el puerto y `listen()` lanza el error.

`listen()` escucha en el puerto 3000 si no le pasas otro. `listen(8080)` usa ese puerto, `listen(8080, '127.0.0.1')` además elige la interfaz, y `listen(0)` toma un puerto libre al azar, útil en pruebas. viga no lee la variable de entorno `PORT` por su cuenta; si la usas, pásala tú: `app.listen(Number(process.env.PORT ?? 3000))`.

### Arrancar sin servidor

`init()` hace los pasos 1 a 3 sin abrir ningún puerto. Sirve para scripts, tareas programadas o workers que usan tus servicios sin atender peticiones HTTP. Con `app.get()` obtienes cualquier provider:

```ts title="scripts/import-books.ts"
import { createApp, runInNewContext } from 'viga';
import { AppModule } from '../src/app.module.ts';
import { BooksService } from '../src/books/books.service.ts';

const app = await createApp({ rootModule: AppModule }).init();

await runInNewContext(() => app.get(BooksService).importFromCsv('books.csv'));

await app.close();
```

`app.get()` busca desde el módulo raíz, así que solo encuentra lo que ese módulo ve: sus propios providers, los que exportan los módulos que importa y los de los módulos globales. Si `BooksService` no se exporta desde `BooksModule`, `app.get(BooksService)` falla con el mismo error que un `inject()` que no encuentra su provider.

`runInNewContext` abre un contexto para que los servicios que usan [claves de contexto](../request-lifecycle/#el-contexto-de-la-petición) funcionen fuera de una petición.

## Los hooks de los providers

Un provider puede implementar estas interfaces para ejecutar código en cada etapa:

| Interfaz | Método | Cuándo se ejecuta |
| --- | --- | --- |
| `OnModuleInit` | `onModuleInit()` | Al arrancar, después de crear todos los providers. |
| `OnServerListen` | `onServerListen(server)` | Justo antes de que el servidor empiece a escuchar. |
| `OnServerClose` | `onServerClose()` | Cuando el servidor empieza a cerrarse. |
| `OnModuleDestroy` | `onModuleDestroy()` | Al detenerse, después de cerrar el servidor. |

Los métodos pueden ser `async`: viga espera a que terminen antes de seguir.

El caso más común es una conexión que se abre al arrancar y se cierra al final:

```ts title="src/database/database.service.ts"
import { Injectable, type OnModuleDestroy, type OnModuleInit } from 'viga';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });

  async onModuleInit() {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
```

`onModuleInit` comprueba que la base de datos responde. Si no responde, la app no arranca, y lo sabes al desplegar en lugar de con la primera petición. Este es el lugar para el trabajo asíncrono que no puede ir en un [`useFactory`](../providers/#usefactory-construir-el-valor-con-código), que tiene que devolver el valor directamente.

`OnServerListen` y `OnServerClose` son para providers que necesitan el servidor HTTP, por ejemplo para atender WebSockets en el mismo puerto. `onServerListen` recibe el `Server` de Node.js antes de que empiece a escuchar. Es lo que usa `viga/websocket`.

### El orden

viga ejecuta los `onModuleInit` en orden de dependencias: si `CacheService` usa `DatabaseService`, el hook de `DatabaseService` termina antes de que empiece el de `CacheService`. Así, cuando un provider se inicializa, todo lo que usa ya está listo.

Los `onModuleDestroy` se ejecutan en el orden inverso: primero `CacheService` y después `DatabaseService`. Así ningún provider pierde una dependencia mientras todavía se está cerrando.

## Detenerse

`close()` detiene la app de forma ordenada:

1. El servidor deja de aceptar conexiones nuevas y cierra las que están inactivas.
2. Se ejecutan los hooks `onServerClose`.
3. viga espera a que terminen las peticiones en curso.
4. Se ejecutan los hooks `onModuleDestroy`, en orden inverso.

Si un `onModuleDestroy` falla, viga sigue cerrando los demás y, al final, `close()` lanza un `AggregateError` con todos los errores. Así, un fallo al cerrar la caché no deja abierta la conexión a la base de datos.

Si la app falló a mitad del arranque, `close()` solo cierra los providers cuyo `onModuleInit` terminó. Un provider que nunca llegó a abrir su conexión no intenta cerrarla.

### Al recibir una señal

Cuando detienes la app con `Ctrl+C`, o cuando Docker o Kubernetes la detienen para desplegar una versión nueva, el sistema envía una señal al proceso. `enableShutdownHooks()` hace que viga llame a `close()` al recibir `SIGTERM` o `SIGINT`, en lugar de terminar de golpe:

```ts
const app = createApp({ rootModule: AppModule }).enableShutdownHooks();
```

Después de cerrar, el proceso termina con el código estándar de la señal: 143 para `SIGTERM` y 130 para `SIGINT`, o 1 si el cierre falló. Termina aunque algo mantenga vivo el proceso, como un temporizador olvidado, y funciona también cuando Node.js es el proceso principal de un contenedor.

Sin `enableShutdownHooks()`, una señal termina el proceso sin ejecutar los `onModuleDestroy`: las peticiones en curso se cortan y las conexiones no se cierran bien. Actívalo siempre en `main.ts`.

Si necesitas otras señales, pásalas como argumento: `enableShutdownHooks(['SIGTERM', 'SIGINT', 'SIGHUP'])`.
