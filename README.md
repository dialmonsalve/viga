# viga

Framework HTTP para Node.js sobre Express 5: módulos, inyección de dependencias, guards e interceptores con **decoradores estándar de JavaScript (TC39)**. Sin `reflect-metadata`, sin `experimentalDecorators` y sin `emitDecoratorMetadata`, así que no depende de cómo compile TypeScript.

El core solo resuelve lo que todo servidor necesita. Lo demás son subrutas opcionales: si no las importas, no se instala nada extra.

| Importación | Qué trae | Requiere |
|---|---|---|
| `viga` | Módulos, DI, controladores, guards, interceptores, `@Public`, excepciones HTTP, ciclo de vida, logger | `express` |
| `viga/validation` | `@Validate` y `ValidationModule` con cualquier librería [Standard Schema](https://standardschema.dev) | Nada (tú eliges Zod, Valibot, ArkType…) |
| `viga/i18n` | Catálogos de mensajes, negociación de `Accept-Language`, mensajes del framework en es/en | Nada |
| `viga/drizzle` | `DrizzleModule` y `DatabaseService` con cierre del pool | `drizzle-orm`, `pg` |

## Requisitos

- Node.js 24.13 o superior
- Express 5
- TypeScript con decoradores estándar (sin `experimentalDecorators`) y `"lib": ["ES2024", "ESNext.Decorators"]`

## Instalación

```bash
pnpm add viga express
pnpm add -D @types/express
```

Solo si usas `viga/drizzle`:

```bash
pnpm add drizzle-orm pg
pnpm add -D @types/pg
```

## Ejemplo mínimo

```ts
import { Controller, Get, Injectable, Module, createApp, inject } from 'viga';

@Injectable()
class BooksService {
  list() {
    return [{ id: 1, title: 'Dune' }];
  }
}

@Controller('/books')
class BooksController {
  private readonly books = inject(BooksService);

  @Get()
  list() {
    return this.books.list();
  }
}

@Module({ controllers: [BooksController], providers: [BooksService] })
class AppModule {}

const app = createApp({ rootModule: AppModule, globalPrefix: '/api/v1' })
  .useAuthGuard(AuthGuard)
  .enableShutdownHooks();

await app.listen(3000);
```

## Core (`viga`)

### Módulos e inyección de dependencias

- Las dependencias se piden con `inject()` en los campos de la clase. Sin reflection no se pueden leer los tipos del constructor.
- Cada módulo ve sus `providers` y lo que exportan los módulos que importa. Un módulo puede reexportar otro poniéndolo en `exports`.
- `global: true` hace que los exports de un módulo estén disponibles en todos sin importarlo. Úsalo solo para infraestructura (base de datos, configuración).
- Providers: clase, `{ provide, useClass }`, `{ provide, useValue }` y `{ provide, useFactory }`. Para valores que no son clases, `new InjectionToken<T>('NOMBRE')`.
- Detecta dependencias e importaciones circulares con la cadena completa en el error.

### Ciclo de vida

Los providers pueden implementar `OnModuleInit` y `OnModuleDestroy`:

- `init()` (o `listen()`) crea todos los providers y ejecuta `onModuleInit` en orden de dependencias. Si un hook devuelve una promesa, se espera.
- `close()` cierra el servidor y ejecuta `onModuleDestroy` en orden inverso. Si alguno falla, intenta cerrar los demás y lanza un `AggregateError`.
- `enableShutdownHooks()` llama a `close()` al recibir `SIGTERM` o `SIGINT`.

### Rutas privadas por defecto

- Toda ruta exige pasar el guard configurado con `app.useAuthGuard()`. Si no hay ninguno, responde 401: nada queda abierto por olvido.
- `@Public()` en un método o en el controlador entero deja la ruta abierta.

### Orden de una petición

Middlewares de la app (`app.use`) → body parser → autenticación (salvo `@Public`) → interceptores globales → del controlador → decoradores del método de arriba abajo (`@UseGuards`, `@UseInterceptors`, `@Validate`) → handler, y de vuelta en orden inverso.

El handler devuelve el resultado: el router responde 200, 201 en POST o 204 si no devuelve nada. `@HttpCode` lo cambia. Si el handler ya respondió con `ctx.res`, el router no toca la respuesta.

### Guards e interceptores

```ts
@Injectable()
class TimingInterceptor implements Interceptor {
  async intercept(ctx: HttpContext, next: CallHandler) {
    const start = performance.now();
    const result = await next();
    ctx.res.setHeader('Server-Timing', `app;dur=${performance.now() - start}`);
    return result;
  }
}

app.useGlobalInterceptors(TimingInterceptor);
```

- Guards e interceptores pueden ser clases (con `inject()`) o funciones.
- `@UseInterceptors` va en el método o en el controlador. `next()` solo puede llamarse una vez.
- Los globales se resuelven con el injector del módulo raíz.

### Contexto por petición

`createContextKey` guarda valores que cualquier código alcanza durante una petición, sin pasarlos de función en función: el usuario autenticado, un id de petición, una transacción.

```ts
import { createContextKey } from 'viga';

export const CURRENT_USER = createContextKey<User>('currentUser');

@Injectable()
class JwtGuard implements CanActivate {
  async canActivate({ req }: HttpContext) {
    const user = await this.verify(req);
    if (!user) return false;
    CURRENT_USER.set(user);
    return true;
  }
}

@Injectable()
class ItemsService {
  create(data: NewItem) {
    const { id } = CURRENT_USER.get();
    return this.items.insert({ ...data, createdById: id, updatedById: id });
  }
}
```

| Método | Qué hace |
|---|---|
| `get()` | Devuelve el valor o lanza un error si no hay ninguno |
| `find()` | Devuelve el valor o `undefined` |
| `set(value)` | Fija el valor para el resto de la petición. Sirve en middlewares, guards e interceptores |
| `run(value, fn)` | Ejecuta `fn` con el valor; al terminar, vuelve el anterior |

- Cada petición tiene su propio contexto, aunque el servidor atienda varias a la vez.
- Fuera de HTTP (scripts, tareas programadas, tests), `runInNewContext(fn)` abre un contexto vacío donde `set()` funciona.

### Middlewares de Express

El framework no impone ninguno. Agrégalos con `app.use()` antes de `listen()`:

```ts
import cors from 'cors';
import helmet from 'helmet';

app.use(helmet(), cors({ origin: 'https://mi-front.com', credentials: true }));
```

### Errores

```json
{
  "statusCode": 404,
  "code": "books.notFound",
  "message": "No existe el libro 7",
  "error": "Not Found",
  "timestamp": "2026-10-22T12:00:00.000Z"
}
```

- Las excepciones reciben un código y parámetros opcionales: `throw new NotFoundException('books.notFound', { id })`.
- El `message` lo decide `resolveMessage`, un hook opcional de `createApp`. Si no lo configuras o devuelve `undefined`, viga usa sus mensajes por defecto en inglés para sus códigos (`errors.*`).
- Si el código no es conocido, se trata como texto libre: va tal cual en `message`, y `code` toma el del estado HTTP (`errors.notFound`).
- Los errores inesperados responden 500 sin filtrar el mensaje interno. Un JSON mal formado responde 400.

```ts
createApp({
  rootModule: AppModule,
  resolveMessage: (code, params, req) => misMensajes[code],
});
```

### Mensajes para desarrolladores

Los errores y logs del propio framework (`[DI] BooksModule cannot resolve BooksService…`) están en inglés por defecto. Se adaptan con un diccionario, que se configura en `main.ts` antes de `createApp()`:

```ts
import { setDiagnostics } from 'viga';
import { diagnosticsEs } from 'viga/i18n';

setDiagnostics(diagnosticsEs);
```

- `viga/i18n` trae el diccionario completo en español.
- Un diccionario puede ser parcial: las claves que no traduce siguen en inglés.
- `DIAGNOSTICS` contiene los textos originales en inglés, para usar como referencia al crear otro diccionario. Los `{parámetros}` se interpolan solos y el prefijo (`[DI]`, `[App]`…) se agrega automáticamente.
- `setDiagnostics({})` vuelve al inglés.

Estos mensajes son para quien programa. Los que ve el usuario final en las respuestas HTTP se configuran con `resolveMessage` o `viga/i18n`.

### Logger

`createApp({ logger })` acepta cualquier objeto con `info`, `warn`, `error` y `debug` (por defecto, `console`). Está disponible en todos los módulos con `inject(LOGGER)`.

## viga/validation

```ts
import { Validate, ValidationModule } from 'viga/validation';
import { z } from 'zod';

const CreateBook = z.object({ title: z.string().min(1) });

@Post()
@Validate({ body: CreateBook })
create({ body }: HttpContext<{ body: typeof CreateBook }>) {
  return this.books.create(body);
}
```

- Valida `body`, `query` y `params` con cualquier schema que implemente Standard Schema, incluso asíncrono. `HttpContext<{ body: typeof Schema }>` tipa los datos ya parseados.
- Si falla, responde 400 con `code: 'errors.validation'` y en `details` los errores por parte de la petición: `{ path, code?, message }`.
- `ValidationModule.forRoot({ formatIssue })` es opcional y personaliza el texto de cada error, por ejemplo para traducirlo.

## viga/i18n

```ts
import { I18n } from 'viga/i18n';

const i18n = new I18n({ defaultLocale: 'es', catalogs: { es, en } });

const app = createApp({ rootModule: AppModule, resolveMessage: i18n.resolveMessage })
  .use(i18n.middleware);
```

- `i18n.middleware` elige el idioma con `Accept-Language` y responde con `Content-Language`.
- `i18n.resolveMessage` traduce los códigos de las excepciones. Trae en español e inglés los mensajes del framework, y tus catálogos pueden reemplazarlos.
- `i18n.t(key, params)` e `i18n.locale()` usan el idioma de la petición en curso, en cualquier servicio.
- Combinado con validación: `ValidationModule.forRoot({ formatIssue: (issue) => traducir(issue, i18n.locale()) })`.

## viga/drizzle

```ts
import { DatabaseService, DrizzleModule } from 'viga/drizzle';
import * as schema from './schema.ts';

declare module 'viga/drizzle' {
  interface Register {
    schema: typeof schema;
  }
}

@Module({
  imports: [DrizzleModule.forRoot({ connection: envs.DATABASE_URL, schema }), BooksModule],
})
class AppModule {}

@Injectable()
class BooksRepository {
  private readonly database = inject(DatabaseService);

  findAll() {
    return this.database.db.query.books.findMany();
  }
}
```

- `DrizzleModule.forRoot()` es global y se registra una sola vez en el módulo raíz.
- `connection` acepta una URL o la configuración completa del `Pool` de `pg`.
- Declarar `Register` tipa `database.db` con tu schema.
- El pool se cierra con `app.close()`. Los errores de conexiones inactivas van al logger y no tumban el proceso.

### Transacciones

Los repositorios usan siempre `database.db`. Fuera de una transacción es la conexión normal; dentro de una, es la transacción en curso, sin pasarla como parámetro.

```ts
@Injectable()
class ReceiptsService {
  private readonly database = inject(DatabaseService);
  private readonly entries = inject(InventoryEntryRepository);
  private readonly movements = inject(StockMovementRepository);
  private readonly orders = inject(PurchaseOrderRepository);

  receive(orderId: number, lines: ReceivedLine[]) {
    return this.database.transaction(async () => {
      const entry = await this.entries.create(orderId, lines);
      await this.movements.recordEntry(entry);
      await this.orders.markReceived(orderId);
      return entry;
    });
  }
}
```

Si cualquier paso lanza un error, se revierte todo. También existe como decorador:

```ts
@Transactional()
async receive(orderId: number, lines: ReceivedLine[]) { … }

@Transactional({ isolationLevel: 'serializable' })
async adjustStock(…) { … }
```

- **Anidadas:** una transacción dentro de otra crea un savepoint. Si la interior falla y capturas el error, solo se revierte lo suyo; si no lo capturas, se revierte todo.
- **Configuración** (`isolationLevel`, `accessMode`, `deferrable`): solo en la transacción exterior. Una anidada que intente cambiarla lanza un error.
- `database.inTransaction()` indica si hay una en curso. `database.root` es siempre la conexión fuera de cualquier transacción.
- **SQL crudo:** usa `database.db.execute(sql\`…\`)`, que respeta la transacción en curso. Usar `database.pool` directamente se la salta.
- No ejecutes transacciones anidadas en paralelo (`Promise.all`) dentro de la misma transacción: comparten una sola conexión.

¿Otro ORM? No hace falta un adaptador: regístralo como un provider con `onModuleDestroy`.

```ts
@Injectable()
class Database implements OnModuleDestroy {
  readonly client = new PrismaClient();

  onModuleDestroy() {
    return this.client.$disconnect();
  }
}
```

## Desarrollo

| Script | Qué hace |
|---|---|
| `pnpm test` | Tests con el runner nativo de Node. Los de PostgreSQL se saltan |
| `pnpm db:test:up` / `db:test:down` | Levanta o apaga un PostgreSQL desechable en el puerto 55432 (datos en memoria) |
| `pnpm test:db` | Todos los tests, incluidos los de PostgreSQL (requiere `db:test:up`) |
| `pnpm check-types` | Comprueba los tipos |
| `pnpm build` | Compila a `dist/` con `tsc` (JS + tipos) |
| `pnpm pack` | Genera el `.tgz` que se publicaría, para probarlo en otro proyecto |

`prepublishOnly` ejecuta tipos, todos los tests (con PostgreSQL) y build antes de cada `npm publish`.
