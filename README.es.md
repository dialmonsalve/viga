# viga

[English](README.md) · **Español** · [Documentación](https://vigajs.dev/es/)

Framework HTTP para Node.js sobre Express 5: módulos, inyección de dependencias, guards e interceptores con **decoradores estándar de JavaScript (TC39)**. Sin `reflect-metadata`, sin `experimentalDecorators` y sin `emitDecoratorMetadata`.

El core solo resuelve lo que todo servidor necesita. Lo demás son paquetes opcionales: instala solo los que uses.

| Importación | Qué trae | Requiere |
|---|---|---|
| `@vigajs/core` | Módulos, DI, controladores, guards, interceptores, `@Public`, excepciones HTTP, ciclo de vida, logger | `express` |
| `@vigajs/validation` | `@Validate` y `ValidationModule` con cualquier librería [Standard Schema](https://standardschema.dev) | Nada (tú eliges Zod, Valibot, ArkType…) |
| `@vigajs/i18n` | Catálogos de mensajes, negociación de `Accept-Language`, mensajes del framework en es/en | Nada |
| `@vigajs/drizzle` | `DrizzleModule` y `DatabaseService` con cierre del pool | `drizzle-orm`, `pg` |
| `@vigajs/config` | `ConfigModule` que valida y tipa las variables de entorno al arrancar | Nada |
| `@vigajs/pagination` | `@Paginate` con resultados tipados, enlaces relativos y límites | Nada |
| `@vigajs/websocket` | Gateways, salas y una interfaz de adaptador pública, con valores restrictivos por defecto | `ws` |
| `@vigajs/testing` | `createTestingApp` para probar la app con peticiones HTTP reales y providers reemplazados | Nada |
| `@vigajs/health` | Rutas `/health` y `/ready` con tus propias comprobaciones, sin revelar detalles | Nada |
| `@vigajs/crypto` | Hash de contraseñas con Argon2id, tokens aleatorios, URLs firmadas y cifrado AES-256-GCM | Nada |
| `@vigajs/events` | Bus de eventos en memoria con eventos tipados, errores aislados y listeners que terminan antes de apagar | Nada |
| `@vigajs/workers` | El mismo worker en la API, en procesos hijos o en otro servidor, con un supervisor que los reinicia | Nada |
| `@vigajs/upload` | `@Upload` con límites, tipos de archivo detectados por su contenido y limpieza automática | `multer`, `file-type` |

## Agradecimientos

viga está inspirado en [NestJS](https://nestjs.com). Los módulos, la inyección de dependencias, los controladores con decoradores, los guards y los interceptores vienen de las ideas que Kamil Myśliwiec y la comunidad de Nest llevan años perfeccionando. Gracias por mostrar que en Node se puede construir backends con estructura.

viga no comparte código con Nest. Toma esas ideas y las lleva a otro terreno: decoradores estándar de JavaScript (TC39) en lugar de `experimentalDecorators` y `reflect-metadata`, promesas en lugar de RxJS y un core pequeño con todo lo demás opcional.

También se apoya en el trabajo de [Express](https://expressjs.com), [Standard Schema](https://standardschema.dev) y [Drizzle ORM](https://orm.drizzle.team).

## Requisitos

- Node.js 24.13 o superior
- Express 5
- TypeScript con decoradores estándar (sin `experimentalDecorators`). Heredar `@vigajs/core/tsconfig.json` lo configura por ti
- Un compilador que transforme los decoradores, como `tsc` o `tsx`. Node ejecuta TypeScript quitando los tipos, pero todavía no soporta decoradores: `node main.ts` falla en el primer `@`.

## Instalación

La forma más rápida es crear un proyecto:

```bash
pnpm create @vigajs mi-app
```

Para añadir viga a un proyecto existente, instala el núcleo y después los módulos que necesites:

```bash
pnpm add @vigajs/core express
pnpm add -D typescript tsx @types/express @types/node
```

```json
{
  "extends": "@vigajs/core/tsconfig.json",
  "include": ["src"]
}
```

Solo si usas `@vigajs/drizzle`:

```bash
pnpm add @vigajs/drizzle drizzle-orm@0.45 pg
pnpm add -D @types/pg
```

Solo si usas `@vigajs/websocket` con el adaptador por defecto:

```bash
pnpm add @vigajs/websocket ws
```

Solo si usas `@vigajs/upload`:

```bash
pnpm add @vigajs/upload multer file-type
```

## Ejemplo mínimo

```ts
import { Controller, Get, Injectable, Module, Public, createApp, inject } from '@vigajs/core';

@Injectable()
class BooksService {
  list() {
    return [{ id: 1, title: 'Dune' }];
  }
}

@Controller('/books')
class BooksController {
  private readonly books = inject(BooksService);

  @Public()
  @Get()
  list() {
    return this.books.list();
  }
}

@Module({ controllers: [BooksController], providers: [BooksService] })
class AppModule {}

const app = createApp({ rootModule: AppModule, globalPrefix: '/api/v1' }).enableShutdownHooks();

await app.listen(3000);
```

Las rutas son privadas por defecto: sin `@Public()`, `GET /api/v1/books` respondería 401 hasta configurar un guard con `app.useAuthGuard()` (ver [Guards](https://vigajs.dev/es/core/guards/)).

## Core (`@vigajs/core`)

### Módulos e inyección de dependencias

Consulta [Módulos](https://vigajs.dev/es/core/modules/) y [Providers e inyección de dependencias](https://vigajs.dev/es/core/providers/) en la documentación.

### Ciclo de vida

Consulta [Ciclo de vida de la app](https://vigajs.dev/es/core/app-lifecycle/) en la documentación.

### Rutas privadas por defecto

Consulta [Guards](https://vigajs.dev/es/core/guards/) en la documentación. Las mismas reglas, incluido que `@Public` no se hereda, valen para los gateways de `@vigajs/websocket`.

### Orden de una petición

Consulta [Ciclo de vida de una petición](https://vigajs.dev/es/core/request-lifecycle/) en la documentación.

### Guards e interceptores

Consulta [Guards](https://vigajs.dev/es/core/guards/) e [Interceptores](https://vigajs.dev/es/core/interceptors/) en la documentación.

### Contexto por petición

Consulta [El contexto de la petición](https://vigajs.dev/es/core/request-lifecycle/#el-contexto-de-la-petición) en la documentación.

### Middlewares de Express

Consulta [Middlewares de Express](https://vigajs.dev/es/core/request-lifecycle/#middlewares-de-express) en la documentación.

### Valores de seguridad por defecto

Consulta [Valores por defecto](https://vigajs.dev/es/security/defaults/) e [IP del cliente y proxies](https://vigajs.dev/es/security/client-ip/) en la documentación. Estos valores reducen riesgos habituales, pero no hacen segura una aplicación por sí solos.

### Rate limiting

Consulta [Límite de peticiones](https://vigajs.dev/es/security/rate-limiting/) en la documentación.

### Checklist para pruebas de seguridad

Consulta [Lista para pruebas de seguridad](https://vigajs.dev/es/security/checklist/) en la documentación.

### Errores

Consulta [Excepciones](https://vigajs.dev/es/core/exceptions/) en la documentación.

### Mensajes para desarrolladores

Consulta [Mensajes para desarrolladores](https://vigajs.dev/es/optional/i18n/#mensajes-para-desarrolladores) en la documentación.

### Logger

Consulta [Usa tu propio logger](https://vigajs.dev/es/core/providers/#usa-tu-propio-logger) en la documentación.

## @vigajs/validation

Consulta [@vigajs/validation](https://vigajs.dev/es/optional/validation/) en la documentación.

## @vigajs/i18n

Consulta [@vigajs/i18n](https://vigajs.dev/es/optional/i18n/) en la documentación.

## @vigajs/config

Consulta [@vigajs/config](https://vigajs.dev/es/optional/config/) en la documentación.

## @vigajs/pagination

Consulta [@vigajs/pagination](https://vigajs.dev/es/optional/pagination/) en la documentación.

## @vigajs/drizzle

Consulta [@vigajs/drizzle](https://vigajs.dev/es/optional/drizzle/) en la documentación.

## @vigajs/websocket

Consulta [@vigajs/websocket](https://vigajs.dev/es/optional/websocket/) en la documentación.

## @vigajs/testing

Consulta [@vigajs/testing](https://vigajs.dev/es/optional/testing/) en la documentación.

## @vigajs/health

Consulta [@vigajs/health](https://vigajs.dev/es/optional/health/) en la documentación.

## @vigajs/crypto

Consulta [@vigajs/crypto](https://vigajs.dev/es/optional/crypto/) en la documentación.

## @vigajs/events

Consulta [@vigajs/events](https://vigajs.dev/es/optional/events/) en la documentación.

## @vigajs/workers

Consulta [@vigajs/workers](https://vigajs.dev/es/optional/workers/) en la documentación.

## @vigajs/upload

Consulta [@vigajs/upload](https://vigajs.dev/es/optional/upload/) en la documentación.

## Generar código

`pnpm exec viga g resource books` crea un módulo, un controlador CRUD, un servicio y sus esquemas, y nunca modifica tus archivos existentes. Consulta [Generar código](https://vigajs.dev/es/start/generate/) en la documentación.

## Desarrollo

| Script | Qué hace |
|---|---|
| `pnpm test` | Tests con el runner nativo de Node. Los de PostgreSQL se saltan |
| `pnpm db:test:up` / `db:test:down` | Levanta o apaga un PostgreSQL desechable en el puerto 55432 (datos en memoria) |
| `pnpm test:db` | Todos los tests, incluidos los de PostgreSQL (requiere `db:test:up`) |
| `pnpm test:coverage` | Tests con un informe de cobertura de `src/` (ejecútalo con `VIGA_TEST_DATABASE_URL` para incluir PostgreSQL). Las líneas que solo contienen tipos pueden aparecer como no cubiertas |
| `pnpm check-types` | Comprueba los tipos |
| `pnpm build` | Compila a `dist/` con `tsc` (JS + tipos) |
| `pnpm pack` | Genera el `.tgz` que se publicaría, para probarlo en otro proyecto |

`prepublishOnly` ejecuta tipos, todos los tests (con PostgreSQL) y build antes de cada `npm publish`.

## Contribuciones

viga es un proyecto personal que mantengo en mi tiempo libre, así que no acepto pull requests ni issues. Puedes hacer un fork bajo la licencia MIT.

## Licencia

[MIT](LICENSE)
