# viga

[English](README.md) · **Español** · [Documentación](https://vigajs.dev/es/)

Framework HTTP para Node.js sobre Express 5: módulos, inyección de dependencias, guards e interceptores con **decoradores estándar de JavaScript (TC39)**. Sin `reflect-metadata`, sin `experimentalDecorators` y sin `emitDecoratorMetadata`.

El core solo resuelve lo que todo servidor necesita. Lo demás son subrutas opcionales: si no las importas, no se instala nada extra.

| Importación | Qué trae | Requiere |
|---|---|---|
| `viga` | Módulos, DI, controladores, guards, interceptores, `@Public`, excepciones HTTP, ciclo de vida, logger | `express` |
| `viga/validation` | `@Validate` y `ValidationModule` con cualquier librería [Standard Schema](https://standardschema.dev) | Nada (tú eliges Zod, Valibot, ArkType…) |
| `viga/i18n` | Catálogos de mensajes, negociación de `Accept-Language`, mensajes del framework en es/en | Nada |
| `viga/drizzle` | `DrizzleModule` y `DatabaseService` con cierre del pool | `drizzle-orm`, `pg` |
| `viga/config` | `ConfigModule` que valida y tipa las variables de entorno al arrancar | Nada |
| `viga/pagination` | `@Paginate` con resultados tipados, enlaces relativos y límites | Nada |
| `viga/websocket` | Gateways, salas y una interfaz de adaptador pública, con valores restrictivos por defecto | `ws` |
| `viga/testing` | `createTestingApp` para probar la app con peticiones HTTP reales y providers reemplazados | Nada |

## Agradecimientos

viga está inspirado en [NestJS](https://nestjs.com). Los módulos, la inyección de dependencias, los controladores con decoradores, los guards y los interceptores vienen de las ideas que Kamil Myśliwiec y la comunidad de Nest llevan años perfeccionando. Gracias por mostrar que en Node se puede construir backends con estructura.

viga no comparte código con Nest. Toma esas ideas y las lleva a otro terreno: decoradores estándar de JavaScript (TC39) en lugar de `experimentalDecorators` y `reflect-metadata`, promesas en lugar de RxJS y un core pequeño con todo lo demás opcional.

También se apoya en el trabajo de [Express](https://expressjs.com), [Standard Schema](https://standardschema.dev) y [Drizzle ORM](https://orm.drizzle.team).

## Requisitos

- Node.js 24.13 o superior
- Express 5
- TypeScript con decoradores estándar (sin `experimentalDecorators`) y `"lib": ["ES2024", "ESNext.Decorators"]`
- Un compilador que transforme los decoradores, como `tsc` o `tsx`. Node ejecuta TypeScript quitando los tipos, pero todavía no soporta decoradores: `node main.ts` falla en el primer `@`.

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

Solo si usas `viga/websocket` con el adaptador por defecto:

```bash
pnpm add ws
```

## Ejemplo mínimo

```ts
import { Controller, Get, Injectable, Module, Public, createApp, inject } from 'viga';

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

## Core (`viga`)

### Módulos e inyección de dependencias

Consulta [Módulos](https://vigajs.dev/es/core/modules/) y [Providers e inyección de dependencias](https://vigajs.dev/es/core/providers/) en la documentación.

### Ciclo de vida

Consulta [Ciclo de vida de la app](https://vigajs.dev/es/core/app-lifecycle/) en la documentación.

### Rutas privadas por defecto

Consulta [Guards](https://vigajs.dev/es/core/guards/) en la documentación. Las mismas reglas, incluido que `@Public` no se hereda, valen para los gateways de `viga/websocket`.

### Orden de una petición

Consulta [Ciclo de vida de una petición](https://vigajs.dev/es/core/request-lifecycle/) en la documentación.

### Guards e interceptores

Consulta [Guards](https://vigajs.dev/es/core/guards/) e [Interceptores](https://vigajs.dev/es/core/interceptors/) en la documentación.

### Contexto por petición

Consulta [El contexto de la petición](https://vigajs.dev/es/core/request-lifecycle/#el-contexto-de-la-petición) en la documentación.

### Middlewares de Express

Consulta [Middlewares de Express](https://vigajs.dev/es/core/request-lifecycle/#middlewares-de-express) en la documentación.

### Valores de seguridad por defecto

Estos valores reducen riesgos comunes, pero no hacen segura una aplicación por sí solos, y viga no puede garantizar que lo sea. La seguridad también depende de tu código, tu configuración, tus dependencias y tu infraestructura, así que prueba y revisa tu app antes de llevarla a producción.

| Opción de `createApp` | Por defecto | Qué controla |
|---|---|---|
| `securityHeaders` | `true` | `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` y `Cache-Control: no-store`. Un objeto cambia (`{ 'Cache-Control': 'private' }`) o quita (`{ 'X-Frame-Options': false }`) cabeceras; `false` las desactiva todas |
| `bodyLimit` | `'100kb'` | Tamaño máximo de un body JSON o urlencoded. Si se supera, responde 413. El body solo se lee en rutas existentes y después de autenticar |
| `trustProxy` | sin confiar | Igual que `trust proxy` de Express. Detrás de un proxy, ponle el número de proxies delante de la app (por ejemplo `1`) o sus direcciones, para que `req.ip` sea la del cliente. Evita `true`: toma el primer valor de `X-Forwarded-For`, que el cliente puede falsificar para saltarse los límites, y viga avisa en el log. El `connectionsPerKey` de WebSocket usa este mismo ajuste |
| `timeouts` | `{ headers: 10_000, request: 30_000, keepAlive: 5_000 }` | Milisegundos para recibir las cabeceras, la petición completa y entre peticiones de una conexión. Limitan ataques de conexiones lentas |
| `requestId` | `true` | Genera un UUID por petición, lo envía en `X-Request-Id`, lo incluye en los errores (`requestId`) y en el log de los 500. `{ trustIncoming: true }` reutiliza el que envía tu gateway si solo tiene letras, números, `.`, `_` o `-` (máximo 128); `{ header }` cambia la cabecera; `false` lo desactiva |
| `requireValidation` | `true` | Una ruta sin schema para el body no acepta body: no se parsea, y una petición que lo envía responde 400 `errors.unexpectedBody`. Un `POST` sin body, como un logout, no necesita decorador, y si olvidas `@Validate({ body })` en una ruta de creación ves el 400 en la primera petición, así que un body sin validar nunca llega a un handler. Aplica a todos los métodos. Tras `@Validate`, `ctx.req.body` también tiene el valor validado, así que el código que lo lea por error no recibe campos que el schema descartó. `false` lo desactiva y todas las rutas reciben el body tal cual |
| `concealRoutes` | activo con guard de autenticación | Una ruta inexistente responde 401 a quien no tiene sesión, igual que una ruta privada. Así es más difícil averiguar qué rutas existen. Con sesión válida responde 404; las rutas `@Public` no cambian. También se aplica a los handshakes de `viga/websocket`: una ruta desconocida responde como un gateway privado (403 con un `Origin` no permitido, 401 sin sesión, 404 con sesión). Viene activo cuando la app tiene `useAuthGuard()`, y apagado sin él para que una API totalmente pública siga respondiendo 404. `false` o `true` lo fuerzan |
| `csrf` | `true` | Rechaza con 403 (`errors.crossSiteRequest`) un `POST` de otro sitio que el navegador puede enviar sin preflight CORS: sin cuerpo, un formulario (`urlencoded`, `multipart`) o `text/plain`. Son las peticiones que una página de otro sitio puede hacer que el navegador envíe con las cookies de tus usuarios sin preflight. Lee `Sec-Fetch-Site` o, si falta, compara `Origin` con el host, y corre antes de parsear el cuerpo. JSON, `PUT`, `PATCH` y `DELETE` desde otro origen no se revisan porque el navegador solo los envía tras un preflight, que decide tu configuración de CORS. Las peticiones sin ninguna de las dos cabeceras, como curl o un backend, pasan. `{ trustedOrigins: ['https://idp.example'] }` permite formularios de esos orígenes, por ejemplo el callback `form_post` de OAuth; `false` la desactiva |

- La cabecera `X-Powered-By` está siempre desactivada.
- El 404 de rutas inexistentes no repite la ruta pedida en la respuesta.
- `DEFAULT_SECURITY_HEADERS` exporta las cabeceras por defecto.
- `REQUEST_ID.get()` devuelve el id de la petición en curso desde cualquier servicio.

### Rate limiting

```ts
import { RateLimit, ipKey, rateLimit } from 'viga';
import { Validate } from 'viga/validation';
import { z } from 'zod';

const Login = z.strictObject({ email: z.email(), password: z.string() });

app.use(rateLimit({ max: 300, windowMs: 60_000 }));

@Public()
@Controller('auth')
class AuthController {
  @Post('login')
  @RateLimit({ max: 5, windowMs: 15 * 60_000, key: (req) => `${ipKey(req.ip ?? '')}:${req.body?.email}` })
  @Validate({ body: Login })
  login({ body }: HttpContext<{ body: typeof Login }>) {}
}
```

- `rateLimit()` es un middleware para toda la app; `@RateLimit()` va en un método o en el controlador. Cada uno lleva su propio contador.
- Al superar `max` dentro de `windowMs` responde 429 con `code: 'errors.tooManyRequests'` y `Retry-After`. Todas las respuestas llevan `RateLimit-Limit`, `RateLimit-Remaining` y `RateLimit-Reset`.
- La clave por defecto es `req.ip` normalizada con `ipKey()`: una dirección IPv4-mapped (`::ffff:1.2.3.4`) cuenta como su IPv4, y una dirección IPv6 cuenta como su red /56, porque quien controla una suele controlar todo el bloque y, si no, conseguiría un contador nuevo por dirección. `ipKey(address, 64)` elige otra longitud de prefijo. Usa `ipKey()` también cuando armes tu propia clave a partir de la IP. Detrás de un proxy, pon en `trustProxy` el número de proxies, o todos los clientes compartirán el mismo contador.
- En HTTP el rate limiting viene desactivado (en WebSocket hay un límite por conexión activado por defecto): añade tú `rateLimit()` o `@RateLimit()`. No se activa solo porque, detrás de un proxy sin `trustProxy`, todos los usuarios compartirían la IP del proxy y quedarían bloqueados a la vez.
- El contador vive en memoria (`MemoryRateLimitStore`). Guarda como máximo 10.000 claves (`new MemoryRateLimitStore({ maxKeys })`), y las claves de más de 128 caracteres se guardan como hash, así que una avalancha de claves únicas (por ejemplo, emails inventados) no puede agotar la memoria. Al llenarse desaloja la clave más antigua que solo se vio una vez, así que una avalancha de claves nuevas no puede borrar el contador de una clave atacada. Si todas las claves guardadas están vivas y repetidas, una clave nueva se trata como limitada hasta que venza alguna: el almacén falla cerrado, no abierto. Sube `maxKeys` si el tráfico legítimo puede llenarlo. El contador es por proceso: con varias instancias, cada una cuenta por su lado y el límite real se multiplica por el número de instancias, así que implementa `RateLimitStore` sobre Redis u otro almacén compartido y pásalo en `store`. La ventana es fija, así que un cliente puede enviar hasta `max` al final de una ventana y otra vez `max` al empezar la siguiente; elige `max` contando con esa ráfaga doble.

### Checklist para pruebas de seguridad

viga solo se encarga de algunas capas comunes. Estas dependen de tu código y son lo primero que revisa una prueba de caja gris, con usuarios y roles reales:

- **Autorización por recurso (IDOR).** Que una ruta exija sesión no basta: comprueba que el recurso pertenece al usuario. Filtra en el repositorio por el usuario actual y responde 404, no 403, cuando no es suyo, para no revelar qué ids existen:
  ```ts
  findOwned(id: number) {
    const { id: ownerId } = CURRENT_USER.get();
    return this.database.db.query.orders.findFirst({
      where: and(eq(orders.id, id), eq(orders.ownerId, ownerId)),
    });
  }
  ```
- **Asignación masiva.** Sin `@Validate`, `ctx.body` llega tal cual lo envía el cliente. Valida todo body que acepte una ruta (`requireValidation` rechaza el body en rutas sin schema) y usa el valor parseado. Con Zod, `z.strictObject()` rechaza campos de más (`"role": "admin"`) en lugar de ignorarlos.
- **Roles.** Pon el guard de rol en el controlador con `@UseGuards` para que una ruta nueva no quede abierta por olvido.
- **Fuerza bruta.** Limita login, registro, recuperación de contraseña y verificación de códigos con `@RateLimit`.
- **CORS.** Lista los orígenes permitidos de forma explícita; nunca `origin: '*'` junto con `credentials: true`.
- **CSRF.** Mantén `csrf` activo si usas cookies, y nunca cambies estado en un `GET`: no se revisa porque un enlace o una imagen pueden dispararlo.
- **Mensajes de error.** No distingas "usuario no existe" de "contraseña incorrecta": usa siempre `UnauthorizedException()`.

### Errores

Consulta [Excepciones](https://vigajs.dev/es/core/exceptions/) en la documentación.

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

Consulta [viga/validation](https://vigajs.dev/es/optional/validation/) en la documentación.

## viga/i18n

```ts
import { I18n } from 'viga/i18n';

const i18n = new I18n({ defaultLocale: 'es', catalogs: { es, en } });

const app = createApp({ rootModule: AppModule, resolveMessage: i18n.resolveMessage })
  .use(i18n.middleware);
```

- `i18n.middleware` elige el idioma con `Accept-Language` y responde con `Content-Language`. Sin cabecera o sin coincidencia, usa `defaultLocale`.
- `resolveLocale` lee el idioma de otro sitio antes que de `Accept-Language`: el nombre de una cabecera (`resolveLocale: 'x-lang'`) o una función (`resolveLocale: (req) => req.cookies.lang`). Si no devuelve un idioma de tus catálogos, se sigue con `Accept-Language` y luego con `defaultLocale`; nunca se usa un valor desconocido.
- Las claves de los catálogos se anidan: `'books.notFound'` busca `{ books: { notFound: '…' } }`.
- `i18n.resolveMessage` traduce los códigos de las excepciones. Trae en español e inglés los mensajes del framework, y tus catálogos pueden reemplazarlos.
- `i18n.t(key, params)` e `i18n.locale()` usan el idioma de la petición en curso, en cualquier servicio.
- `i18n.match(valor)` devuelve el idioma soportado que coincide con un valor (`'pt-BR'` → `'pt'`), o `undefined`; `i18n.negotiate(acceptLanguage)` usa `defaultLocale` si no hay coincidencia.
- Combinado con validación: `ValidationModule.forRoot({ formatIssue: (issue) => traducir(issue, i18n.locale()) })`.

## viga/config

Consulta [viga/config](https://vigajs.dev/es/optional/config/) en la documentación.

## viga/pagination

```ts
import { Paginate, type PageContext } from 'viga/pagination';

@Get()
@Paginate({ defaultLimit: 20, maxLimit: 100 })
@Validate({ query: BookFilter })
async list({ page, query }: PageContext<{ query: typeof BookFilter }>) {
  const [books, total] = await this.books.findPage(query, page.offset, page.limit);
  return page.result(books, total);
}
```

```json
{
  "data": [ … ],
  "meta": { "total": 95, "page": 2, "lastPage": 5, "next": "/api/books?status=open&page=3&limit=20", "prev": "/api/books?status=open&page=1&limit=20" }
}
```

- `@Paginate` lee `?page` y `?limit`, y le da al handler `page.page`, `page.limit` y `page.offset` para tu consulta. viga no consulta la base de datos: funciona con cualquier ORM.
- `page.result(items, total)` construye la respuesta. Es genérico, así que devolver `Book[]` hace que el handler devuelva `PaginatedResult<Book>`; exporta ese tipo para compartirlo con tu frontend.
- `next` y `prev` son enlaces relativos que conservan los demás parámetros de la URL. Nunca se construyen con la cabecera `Host`, así que un host falsificado no puede convertirlos en enlaces a otro dominio.
- Un `limit` mayor que `maxLimit` (100 por defecto) se recorta en lugar de rechazarse, así que `?limit=1000000` no puede hacer que la base de datos devuelva una tabla entera. `maxPage` (1000 por defecto) y `maxOffset` (10.000 filas por defecto) limitan cuánto puede avanzar un cliente, porque un `OFFSET` enorme es lento aunque no devuelva nada. La página máxima depende del `limit`: con `limit=100` es la 101. Para listas más profundas, usa paginación por cursor (`WHERE id > :ultimo`).
- Un `page` inválido (no entero, menor que 1, más allá de `maxPage` o `maxOffset`, o repetido) responde 400 `errors.invalidPage` con la página máxima permitida en el mensaje; un `limit` inválido responde 400 `errors.invalidLimit`.
- Con `@Validate({ query })`, el schema tiene que aceptar `page` y `limit` (un `z.object()` no estricto lo hace).

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
- El pool trae límites por defecto: `statement_timeout` de 30 segundos (igual que el timeout de la petición), `connectionTimeoutMillis` de 10 segundos e `idle_in_transaction_session_timeout` de 60 segundos, así que una consulta lenta o una transacción olvidada no retienen conexiones para siempre. Tu `connection` sobrescribe cualquiera de ellos.
- Al arrancar, viga avisa si se conecta sin TLS a un host que no es local, o si TLS tiene `rejectUnauthorized: false`. En producción usa `?sslmode=verify-full` o `ssl: { ca }`.
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

## viga/websocket

```ts
import { z } from 'zod';
import { Gateway, OnMessage, WebSocketModule, WsServer, type WsContext } from 'viga/websocket';

const Join = z.object({ room: z.string().min(1) });
const Say = z.object({ room: z.string(), text: z.string().max(500) });

@Gateway('/chat')
class ChatGateway {
  private readonly server = inject(WsServer);

  @OnMessage('join', Join)
  join({ client, data }: WsContext<typeof Join>) {
    client.join(data.room);
    return { joined: data.room };
  }

  @OnMessage('say', Say)
  say({ client, data }: WsContext<typeof Say>) {
    this.server.to(data.room).send('said', { from: client.state.userId, text: data.text }, { except: client });
  }
}

@Module({
  imports: [
    WebSocketModule.forRoot({
      authenticate: async (req) => verifySession(req.headers.cookie),
      allowedOrigins: ['https://mi-front.com'],
    }),
    ChatModule,
  ],
})
class AppModule {}
```

- Los gateways son providers: van en los `providers` de un módulo. Usan el mismo puerto que HTTP e `inject()` como cualquier servicio.
- Los mensajes son JSON: `{ "event": "join", "data": { … }, "id": 1 }`. Lo que devuelve el handler se envía como `{ event, data, id }`; un `async function*` envía un mensaje por cada valor. Los errores llegan como `{ "event": "error", "data": { statusCode, code, message, details? }, id }`, con los mismos códigos que HTTP y sin filtrar mensajes internos.
- Salas: `client.join(sala)`, `client.leave(sala)`, `client.rooms`, e `inject(WsServer).to(sala).send(evento, datos, { except })` o `.broadcast(…)`. Un cliente puede estar en varias salas y sale de todas al desconectarse. Las salas viven en memoria: con varias instancias, un mensaje no llega a los clientes conectados a otra.
- El `WebSocket` del navegador no puede enviar cabeceras propias: el handshake solo lleva la URL, las cookies, `Origin` y `Accept-Language`. Autentica con la cookie de sesión (o con un token de vida corta en la URL, teniendo en cuenta que las URLs acaban en los logs), no con `Authorization`.
- Con `i18n`, el idioma se negocia una vez en el handshake (primero `resolveLocale`, luego `Accept-Language`, luego el idioma por defecto) y se aplica a cada mensaje de esa conexión: `i18n.t()` e `i18n.locale()` funcionan dentro de los gateways, los mensajes de error se traducen y `client.locale` lo guarda.
- Igual que en las rutas HTTP, los gateways privados sin `authenticate` generan un aviso al arrancar, y los públicos se listan con nivel `debug`.
- `client.state` guarda datos de la conexión. Lo que devuelve `authenticate` (un objeto) queda ahí.
- La autenticación solo ocurre en el handshake, así que una sesión debe vencer sola. Si `authenticate` devuelve `expiresAt` (un `Date` o milisegundos, por ejemplo el `exp * 1000` de un JWT), la conexión se cierra con 1008 `Session expired` en ese momento y se ejecuta `onDisconnect`. Un handshake cuya sesión ya venció responde 401, y un `expiresAt` que no es una fecha válida responde 500 y registra un error en vez de ignorarse. `client.expiresAt` lo lee y `client.expireAt(fecha)` lo renueva, por ejemplo tras un refresh de token enviado por el socket; `client.expireAt(undefined)` lo quita. Para revocar una sesión al instante, cierra sus clientes desde `WsServer.clients`.
- `RateLimit` de `viga/websocket` limita un evento (en el método) o todos los de un gateway (en la clase), además de `messageRateLimit`. Por defecto cuenta por conexión; `key: ({ client }) => String(client.state.userId)` cuenta por usuario aunque abra varias pestañas. Al superarlo responde `errors.tooManyRequests` con `details.retryAfter` en segundos. El `@RateLimit` de `viga` es solo para rutas HTTP.
- `@UseGuards` y `@UseInterceptors` funcionan por mensaje, en el método o en todo el gateway. `OnWsConnection` y `OnWsDisconnect` son hooks del ciclo de vida de cada conexión.
- `ws` solo se carga si hay algún gateway: `pnpm add ws`.

| Opción de `WebSocketModule.forRoot` | Por defecto | Qué controla |
|---|---|---|
| `authenticate` | ninguna | Comprueba la petición del handshake. Los gateways son privados por defecto: sin `authenticate`, solo aceptan conexiones los `@Public()`. Si devuelve `false`, responde 401 |
| `handshakeTimeoutMs` | `10_000` | Si `authenticate` tarda más, el handshake responde 503 y se registra un aviso, para que un servicio de autenticación lento no acumule sockets abiertos |
| `allowedOrigins` | `[]` | Lista o función. Una petición con un `Origin` no permitido responde 403 (evita el secuestro de WebSocket entre sitios). Las peticiones sin `Origin` (clientes que no son navegador) se aceptan |
| `maxConnections` | `10_000` | Conexiones simultáneas entre todos los gateways, contando los handshakes en curso. Por encima, el handshake responde 503. Es un límite global; para limitar por cliente, usa `connectionsPerKey` |
| `maxPendingHandshakes` | `100` | Handshakes que a la vez siguen comprobando `Origin` o ejecutando `authenticate`, incluidas las rutas desconocidas con `concealRoutes`. Por encima, el handshake responde 503 sin llamar a `authenticate`, así que una avalancha de upgrades no puede lanzar miles de consultas de autenticación en paralelo |
| `connectionsPerKey` | `{ max: 50 }` | Limita las conexiones simultáneas por cliente, contando los handshakes en curso; al superarlo, el handshake responde 429. Por defecto la clave es la IP del cliente resuelta con el `trustProxy` de la app y normalizada con `ipKey()` (IPv6 agrupada por /56). Si un handshake trae un `X-Forwarded-For` en el que `trustProxy` no confía, viga registra un aviso una vez, porque todos los clientes detrás de ese proxy compartirían un contador. `key` recibe la petición del handshake para contar por otra cosa; si devuelve `undefined`, no se limita. `false` lo desactiva |
| `maxPayload` | 100 KiB | Un mensaje más grande cierra la conexión con 1009 |
| `messageRateLimit` | `{ max: 100, windowMs: 10_000 }` | Mensajes por conexión, de cualquier evento, contados al llegar aunque `onConnection` siga en curso. Al superarlo responde `errors.tooManyRequests` con `details.retryAfter`; un cliente que llega al doble del límite dentro de una ventana se desconecta con 1008 `Too many messages`. `false` lo desactiva. Aparte, una conexión que acumula más de 100 mensajes antes de que termine `onConnection` también se cierra con 1008 |
| `requireValidation` | `true` | La app no arranca si un `@OnMessage` no tiene schema. Un evento sin datos declara `z.undefined()` |
| `heartbeatMs` | `30_000` | Hace ping a cada cliente; el que no responde se desconecta |
| `maxBufferedBytes` | 1 MiB | Un cliente que no lee sus mensajes se desconecta en lugar de llenar la memoria del servidor |
| `maxRoomsPerClient` | `100` | Salas en las que puede estar una conexión a la vez. Unirse a una más responde `errors.tooManyRooms` |
| `i18n` | ninguna | Una instancia de `I18n` de `viga/i18n`. Activa el idioma por conexión y, si no defines `resolveMessage`, traduce los mensajes de error |
| `resolveLocale` | ninguna | El nombre de una cabecera o una función de la petición del handshake, que se lee antes que `Accept-Language`. En navegadores, léelo de la URL: `(req) => new URL(req.url, 'http://localhost').searchParams.get('lang')` |
| `resolveMessage` | ninguna | Igual que en `createApp`, para los mensajes de error |
| `adapter` | `ws` | Cualquier `WsAdapter`. La interfaz es pública, así que se pueden conectar otras librerías |

Cambiar de adaptador no cambia tus gateways, pero sí el cliente: con `ws`, el `WebSocket` nativo del navegador funciona tal cual.

Un adaptador recibe las rutas de los gateways (`paths`), `maxPayload`, `heartbeatMs`, `verify(req)` (para aceptar o rechazar cada handshake) y `onConnection(connection, req)`. [`test/websocket/socket-io-adapter.ts`](test/websocket/socket-io-adapter.ts) es un adaptador completo sobre socket.io, que los tests usan para comprobar que la interfaz no depende de `ws`. Con socket.io, un handshake rechazado no conserva el código de estado de viga (socket.io responde con su propio error), y el cliente tiene que ser `socket.io-client`.

## viga/testing

Consulta [viga/testing](https://vigajs.dev/es/optional/testing/) en la documentación.

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
