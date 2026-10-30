---
title: viga/config
description: Valida y tipa las variables de entorno al arrancar, para que una configuración incorrecta impida iniciar la app en lugar de fallar en producción.
sidebar:
  order: 2
---

`viga/config` lee las variables de entorno, las valida con un esquema al arrancar la app y las entrega ya convertidas y con su tipo. Si falta una variable o su valor no es válido, la app no arranca y el error dice cuáles fallan.

Sin esto, una variable mal escrita aparece como `undefined` en mitad de una petición, a veces días después del despliegue. Con `viga/config`, el problema sale al iniciar la app, antes de atender a nadie.

Funciona con cualquier librería compatible con Standard Schema, la misma que uses con [`viga/validation`](../validation/). Los ejemplos usan Zod.

## Define el esquema

Describe las variables que necesita tu app:

```ts title="src/config.ts"
import { z } from 'zod';

export const Env = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
});

declare module 'viga/config' {
  interface Register {
    schema: typeof Env;
  }
}
```

Las variables de entorno siempre son texto, así que usa `z.coerce` para las que deben ser números o booleanos. Aquí `PORT` pasa de `'3000'` a `3000`, y si no está definida vale `3000` por el `default`.

El bloque `declare module` registra tu esquema en `viga/config`. Gracias a él, TypeScript sabe qué tipo tiene cada variable cuando la pides. Solo tienes que escribirlo una vez en todo el proyecto.

## Registra el módulo

Importa `ConfigModule.forRoot` en el módulo raíz. Es un módulo global, así que la configuración queda disponible en todos los módulos:

```ts title="src/app.module.ts"
import { Module } from 'viga';
import { ConfigModule } from 'viga/config';
import { BooksModule } from './books/books.module.ts';
import { Env } from './config.ts';

@Module({ imports: [ConfigModule.forRoot({ schema: Env }), BooksModule] })
export class AppModule {}
```

## Usa la configuración

Pide `CONFIG` con `inject()` desde cualquier provider:

```ts title="src/database/database.service.ts"
import { Injectable, inject, type OnModuleDestroy } from 'viga';
import { CONFIG } from 'viga/config';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly config = inject(CONFIG);
  readonly pool = new Pool({ connectionString: this.config.DATABASE_URL });

  async onModuleDestroy() {
    await this.pool.end();
  }
}
```

`this.config.DATABASE_URL` es un `string` y `this.config.PORT` es un `number`, sin conversiones ni comprobaciones de `undefined`. Si escribes mal el nombre de una variable, TypeScript lo marca.

### En `main.ts`

viga no lee la variable `PORT` por su cuenta. Para pasarla a `listen()`, arranca la app con `init()` y lee la configuración con `app.get()`:

```ts title="src/main.ts"
import { createApp } from 'viga';
import { CONFIG } from 'viga/config';
import { AppModule } from './app.module.ts';

const app = await createApp({ rootModule: AppModule, globalPrefix: '/api' }).enableShutdownHooks().init();

await app.listen(app.get(CONFIG).PORT);
```

`app.get()` solo funciona después de `init()`, porque antes la configuración todavía no se ha validado.

## Cuando la configuración no es válida

Si alguna variable falla, la app no arranca y el error las lista todas a la vez:

```txt
[Config] Invalid configuration:
  - DATABASE_URL: Invalid URL
  - JWT_SECRET: Too small: expected string to have >=32 characters
```

Así puedes corregirlas todas de una vez, en lugar de descubrirlas una por una.

### Los valores nunca aparecen en el error

Las variables de entorno suelen contener secretos, y los errores acaban en logs que lee más gente. Por eso viga nunca muestra el valor de una variable en el error. Si un mensaje lo incluye, por ejemplo uno que escribiste tú, viga lo reemplaza por `***`:

```txt
  - JWT_SECRET: JWT_SECRET is too short: ***
```

## La configuración no se puede modificar

viga congela el resultado, incluidos los objetos y arrays anidados. Ningún código puede cambiar la configuración mientras la app está en marcha: intentarlo lanza un `TypeError`.

Además, la configuración solo contiene las variables que declaraste. El resto de `process.env`, como `PATH` o las variables de otros servicios, no está en `CONFIG`.

## Archivos `.env`

viga no lee archivos `.env` por su cuenta: cargar el archivo es una decisión que queda visible en tu proyecto. Node.js ya sabe hacerlo, y tienes dos formas de pedírselo. Elige la que prefieras; el resultado es el mismo.

### Desde el código

`process.loadEnvFile()` carga el archivo `.env` de la carpeta desde la que arrancas la app. Llámalo al principio de `main.ts`:

```ts title="src/main.ts" ins={1,6}
import { existsSync } from 'node:fs';
import { createApp } from 'viga';
import { CONFIG } from 'viga/config';
import { AppModule } from './app.module.ts';

if (existsSync('.env')) process.loadEnvFile();

const app = await createApp({ rootModule: AppModule, globalPrefix: '/api' }).enableShutdownHooks().init();

await app.listen(app.get(CONFIG).PORT);
```

No necesitas tocar el `package.json`, y funciona igual con `tsx` y con `node`. La comprobación con `existsSync` evita que la app falle donde no hay archivo, como en producción.

Funciona aunque `AppModule` se importe antes de la llamada, porque `viga/config` lee las variables al arrancar la app, no al importar el módulo.

### Desde los scripts

La opción `--env-file-if-exists` de Node.js hace lo mismo desde la línea de comandos, y `tsx` también la acepta:

```json title="package.json"
{
  "scripts": {
    "dev": "tsx watch --env-file-if-exists=.env src/main.ts",
    "start": "node --env-file-if-exists=.env dist/main.js"
  }
}
```

Si el archivo no existe, Node.js muestra un aviso y sigue sin él. Si prefieres que la app no arranque cuando falta el archivo, usa `--env-file` en su lugar.

### Las variables del entorno tienen prioridad

En las dos formas, el archivo nunca reemplaza una variable que ya existe en el entorno. En producción, lo habitual es que las variables vengan de Docker, Kubernetes o tu plataforma de despliegue: esas ganan siempre, aunque haya un `.env` en el servidor.

:::caution
No subas el archivo `.env` al repositorio: añádelo a `.gitignore`. Si quieres documentar qué variables hacen falta, sube un `.env.example` con las mismas claves y valores de ejemplo.
:::

## Otra fuente de variables

Por defecto, `ConfigModule` lee `process.env`. La opción `env` acepta cualquier objeto, por ejemplo uno construido en una prueba:

```ts
ConfigModule.forRoot({
  schema: Env,
  env: { DATABASE_URL: 'postgres://localhost/test', JWT_SECRET: 'x'.repeat(32) },
});
```

### Secretos desde un servicio externo

Si algunos secretos vienen de un servicio como Vault o AWS Secrets Manager, cárgalos antes y pásalos con `env`, junto con las variables del entorno:

```ts title="src/config.ts"
const secrets = await loadSecretsFromVault();

export const env = { ...process.env, ...secrets };
```

```ts title="src/app.module.ts"
@Module({ imports: [ConfigModule.forRoot({ schema: Env, env }), BooksModule] })
export class AppModule {}
```

`loadSecretsFromVault` representa la función que use tu servicio de secretos. El `await` de nivel superior funciona porque el proyecto usa módulos ES: cuando se evalúa `AppModule`, los secretos ya están cargados. Después, `viga/config` los valida igual que cualquier otra variable.

## El esquema tiene que ser síncrono

viga valida la configuración de forma síncrona, porque los providers la usan mientras se construyen: el `Pool` del ejemplo anterior necesita `DATABASE_URL` en ese mismo momento. Si el esquema tiene validaciones asíncronas, como un `refine` que consulta un servicio, la app no arranca y el error lo explica.

Lo que suele motivar una validación asíncrona tiene su propio lugar:

- **Cargar secretos** de un servicio externo: antes de arrancar, como en el ejemplo anterior.
- **Comprobar que un servicio responde**, como la base de datos: en el `onModuleInit` de su provider, como se explica en el [ciclo de vida de la app](../../core/app-lifecycle/#los-hooks-de-los-providers).
