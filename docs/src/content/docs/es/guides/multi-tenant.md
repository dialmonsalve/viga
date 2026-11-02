---
title: Multi-tenant con subdominios
description: Una sola app para varias empresas, cada una en su subdominio, con los datos separados y sin que un usuario pueda entrar en otra empresa.
sidebar:
  order: 4
---

En una app multi-tenant, varias empresas (*tenants*) usan la misma app y la misma base de datos, cada una con sus datos. Una forma habitual de separarlas es el subdominio: `acme.miapp.com` es la empresa Acme y `globex.miapp.com` es Globex.

viga no trae nada específico para esto, porque se resuelve con piezas que ya tiene: un middleware que identifica la empresa, una [clave de contexto](../../core/request-lifecycle/#el-contexto-de-la-petición) que la guarda y un guard que comprueba que el usuario pertenece a ella.

:::caution
El error más grave en una app multi-tenant es que un usuario vea datos de otra empresa. Todo lo que envía el cliente, también el subdominio, se puede falsificar. Identificar la empresa no basta: hay que comprobar siempre que el usuario pertenece a ella, y filtrar todas las consultas.
:::

## Identifica la empresa

Una clave de contexto guarda la empresa de la petición actual:

```ts title="src/tenants/current-tenant.ts"
import { createContextKey } from '@vigajs/core';

export interface Tenant {
  id: number;
  slug: string;
}

export const CURRENT_TENANT = createContextKey<Tenant>('currentTenant');
```

Un middleware lee el subdominio, busca la empresa y la guarda. Si no existe, responde 404:

```ts title="src/tenants/tenant.middleware.ts"
import type { RequestHandler } from 'express';
import { NotFoundException } from '@vigajs/core';
import { CURRENT_TENANT } from './current-tenant.ts';
import type { TenantsService } from './tenants.service.ts';

const BASE_DOMAIN = 'miapp.com';

function slugFrom(hostname: string) {
  const suffix = `.${BASE_DOMAIN}`;
  if (!hostname.endsWith(suffix)) return undefined;

  const slug = hostname.slice(0, -suffix.length);
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) ? slug : undefined;
}

export function tenantMiddleware(tenants: () => TenantsService): RequestHandler {
  return async (req, _res, next) => {
    const slug = slugFrom(req.hostname);
    const tenant = slug && (await tenants().findBySlug(slug));
    if (!tenant) throw new NotFoundException();

    CURRENT_TENANT.set(tenant);
    next();
  };
}
```

`slugFrom` solo acepta un subdominio válido justo delante de tu dominio: rechaza el dominio raíz (`miapp.com`), los dominios ajenos (`evil.com`), los subdominios anidados (`a.acme.miapp.com`) y los que empiezan o terminan con un guion.

Se usa un middleware y no un guard porque tiene que ejecutarse **antes del guard de autenticación**, y también en las rutas públicas, como el inicio de sesión.

Regístralo en `main.ts`. Los middlewares se añaden antes de arrancar, pero `app.get()` solo funciona después, así que se le pasa una función que obtiene el servicio cuando llega cada petición:

```ts title="src/main.ts"
const app = createApp({ rootModule: AppModule, trustProxy: 1 })
  .enableShutdownHooks()
  .useAuthGuard(AuthGuard);

app.use(tenantMiddleware(() => app.get(TenantsService)));

await app.listen();
```

`TenantsService` tiene que estar visible desde el módulo raíz, como cualquier provider que pidas con `app.get()`.

Este middleware se ejecuta en todas las peticiones, así que guarda las empresas en memoria unos segundos en lugar de consultar la base de datos cada vez.

## Comprueba que el usuario pertenece a la empresa

Este es el paso clave. El subdominio lo elige quien hace la petición: sin esta comprobación, un usuario de Acme podría entrar en `globex.miapp.com` con su sesión y ver los datos de Globex.

Si usas [JWT](../jwt-auth/), incluye la empresa en el token al iniciar sesión:

```ts
new SignJWT({ tenantId: tenant.id })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(user.id)
  .setExpirationTime('15m')
  .sign(key);
```

Y compárala en el guard de autenticación:

```ts title="src/auth/auth.guard.ts" ins={8}
async canActivate({ req }: HttpContext) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;

  try {
    const { sub, tenantId } = await this.tokens.verify(header.slice('Bearer '.length));
    if (typeof sub !== 'string') return false;
    if (tenantId !== CURRENT_TENANT.get().id) return false;

    CURRENT_USER.set({ id: sub });
    return true;
  } catch {
    return false;
  }
}
```

Así, un token de Acme usado en `globex.miapp.com` responde 401.

Al iniciar sesión, busca al usuario **dentro de la empresa actual**, no en toda la base de datos, para que el mismo email pueda existir en dos empresas sin mezclarse.

## Filtra todas las consultas

Cada tabla con datos de una empresa lleva una columna `tenant_id`, y cada consulta filtra por ella. Hazlo en los repositorios, leyendo `CURRENT_TENANT`, para que ningún servicio lo tenga que recordar:

```ts title="src/books/books.repository.ts"
findAll() {
  const { id } = CURRENT_TENANT.get();
  return this.database.db.select().from(books).where(eq(books.tenantId, id));
}

create(title: string) {
  const { id } = CURRENT_TENANT.get();
  return this.database.db.insert(books).values({ title, tenantId: id }).returning();
}
```

Olvidar un filtro basta para mezclar datos de dos empresas. Como segunda barrera, PostgreSQL permite definir [políticas de seguridad por fila](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), que aplican el filtro en la propia base de datos.

`CURRENT_TENANT.get()` lanza un error si no hay empresa, en lugar de devolver datos de todas. Fuera de una petición, como en un script o una tarea en segundo plano, ábrele su contexto con [`runInNewContext`](../../core/request-lifecycle/#fuera-de-una-petición) y guarda la empresa antes de usar los repositorios.

## Registra una empresa

El frontend puede sugerir el slug a partir del nombre mientras el usuario escribe, y mostrarle cómo quedará su dirección. Pero la validación es del backend, porque una petición se puede enviar sin pasar por tu frontend:

```ts title="src/tenants/tenants.schemas.ts"
import { z } from 'zod';

const RESERVED = ['www', 'api', 'admin', 'app', 'mail', 'static', 'status'];

export const CreateTenant = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
    .refine((slug) => !RESERVED.includes(slug)),
});
```

- **El formato** es el de un subdominio válido: minúsculas, números y guiones, sin guiones al principio ni al final, y hasta 63 caracteres.
- **Los nombres reservados** evitan que alguien registre direcciones como `admin.miapp.com` o `api.miapp.com`. Añade a la lista los subdominios que uses.
- **Que no exista ya** solo lo sabe la base de datos: pon una restricción `UNIQUE` en la columna `slug`, y traduce el error de clave duplicada a un 409 con un [interceptor](../../core/interceptors/#traduce-errores).

Ten en cuenta que el slug forma parte de la dirección de la empresa, así que cambiarlo después rompe los enlaces guardados.

## Detrás de un proxy

Con [`trustProxy`](../../security/client-ip/) activado, `req.hostname` deja de leer la cabecera `Host` y lee `X-Forwarded-Host`: una petición a `acme.miapp.com` con `X-Forwarded-Host: globex.miapp.com` se trata como Globex.

Asegúrate de que tu proxy **sobrescribe** `X-Forwarded-Host` con el host real, en lugar de pasar el que envía el cliente. Y es otra razón por la que la comprobación de pertenencia es imprescindible: aunque alguien falsifique el host, su token sigue siendo de su empresa.

## Cookies y CORS

Si usas cookies de sesión, no les pongas el atributo `Domain`: así el navegador solo las envía al subdominio que las creó, y no a las demás empresas.

Si el frontend de cada empresa está en su propio subdominio, CORS tiene que aceptar esos orígenes. Compara con una expresión exacta, no con un simple `endsWith('miapp.com')`, que también aceptaría `https://evilmiapp.com`:

```ts
import cors from 'cors';

app.use(cors({ origin: /^https:\/\/[a-z0-9-]+\.miapp\.com$/, credentials: true }));
```

## WebSocket

El handshake de un WebSocket no pasa por los middlewares, así que `CURRENT_TENANT` no tiene valor en él. Identifica la empresa en `authenticate`, a partir de la cabecera `Host`, comprueba que el usuario pertenece a ella y guárdala en la conexión:

```ts
WebSocketModule.forRoot({
  authenticate: async (req) => {
    const session = await verifySession(req);
    const tenant = await findTenantByHost(req.headers.host);
    if (!session || !tenant || session.tenantId !== tenant.id) return false;
    return { userId: session.userId, tenantId: tenant.id };
  },
}),
```

Después usa `client.state.tenantId` en los mensajes, y añade la empresa al nombre de las salas, como `` `${tenantId}:general` ``, para que dos empresas no compartan una misma sala.
