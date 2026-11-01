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

Consulta [Mensajes para desarrolladores](https://vigajs.dev/es/optional/i18n/#mensajes-para-desarrolladores) en la documentación.

### Logger

`createApp({ logger })` acepta cualquier objeto con `info`, `warn`, `error` y `debug` (por defecto, `console`). Está disponible en todos los módulos con `inject(LOGGER)`.

## viga/validation

Consulta [viga/validation](https://vigajs.dev/es/optional/validation/) en la documentación.

## viga/i18n

Consulta [viga/i18n](https://vigajs.dev/es/optional/i18n/) en la documentación.

## viga/config

Consulta [viga/config](https://vigajs.dev/es/optional/config/) en la documentación.

## viga/pagination

Consulta [viga/pagination](https://vigajs.dev/es/optional/pagination/) en la documentación.

## viga/drizzle

Consulta [viga/drizzle](https://vigajs.dev/es/optional/drizzle/) en la documentación.

## viga/websocket

Consulta [viga/websocket](https://vigajs.dev/es/optional/websocket/) en la documentación.

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
