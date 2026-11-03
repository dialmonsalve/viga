---
title: Guards
description: Cómo viga decide si una petición puede llegar a una ruta, con el guard de autenticación, @Public() y los guards de cada ruta.
sidebar:
  order: 4
---

Un guard decide si una petición puede seguir hasta el método del controlador. Devuelve `true` para dejarla pasar o `false` para rechazarla.

viga tiene dos clases de guards:

- **El guard de autenticación**, uno para toda la app. Responde a la pregunta "¿quién eres?" y protege todas las rutas salvo las marcadas con `@Public()`.
- **Los guards de cada ruta**, que pones con `@UseGuards()`. Responden a la pregunta "¿puedes hacer esto?", por ejemplo si el usuario es administrador.

## Rutas privadas por defecto

En viga todas las rutas son privadas. Si la app no tiene un guard de autenticación, las rutas privadas responden 401, y al arrancar viga avisa de cuántas son:

```txt
No auth guard is configured, so the 3 private routes will respond 401; add app.useAuthGuard() or mark public routes with @Public()
```

Así ninguna ruta queda abierta por olvido. Para abrir una, márcala con `@Public()`, sobre el método o sobre toda la clase. Lo viste en [controladores](../controllers/#rutas-privadas-por-defecto).

## El guard de autenticación

Un guard es una clase con un método `canActivate`, que recibe el mismo contexto que los métodos del controlador:

```ts title="src/auth/auth.guard.ts"
import { Injectable, inject, type CanActivate, type HttpContext } from 'viga';
import { SessionsService } from './sessions.service.ts';
import { CURRENT_USER } from './current-user.ts';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly sessions = inject(SessionsService);

  async canActivate({ req }: HttpContext) {
    const user = await this.sessions.findUser(req.headers.authorization);
    if (!user) return false;
    CURRENT_USER.set(user);
    return true;
  }
}
```

Se registra una sola vez, en `main.ts`:

```ts title="src/main.ts" ins={7}
import { createApp } from 'viga';
import { AppModule } from './app.module.ts';
import { AuthGuard } from './auth/auth.guard.ts';

const app = createApp({ rootModule: AppModule, globalPrefix: '/api' })
  .enableShutdownHooks()
  .useAuthGuard(AuthGuard);

await app.listen();
```

viga ejecuta este guard antes de cada ruta privada. Si devuelve `false`, responde 401 y el método no se ejecuta. Cómo verificar la sesión o el token es decisión tuya: viga no trae JWT ni sesiones, y puedes usar la librería que prefieras.

`AuthGuard` puede pedir providers con `inject()` y no hace falta declararlo en `providers`: viga lo crea con el contenedor del módulo raíz, así que puede pedir lo que ese módulo ve, incluidos los módulos globales.

### Comparte el usuario con el resto del código

El guard guarda el usuario en `CURRENT_USER`, una clave de contexto. Cualquier código que se ejecute durante esa petición puede leerlo sin recibirlo como parámetro:

```ts title="src/auth/current-user.ts"
import { createContextKey } from 'viga';

export interface User {
  id: number;
  role: 'admin' | 'editor' | 'reader';
}

export const CURRENT_USER = createContextKey<User>('currentUser');
```

```ts title="src/books/books.controller.ts"
@Get('/mine')
mine() {
  return this.books.findByOwner(CURRENT_USER.get().id);
}
```

`CURRENT_USER.get()` devuelve un `User`, no un `User | undefined`, así que no necesitas comprobarlo ni escribir `!`. Si vienes de NestJS, es lo que reemplaza a `req.user!.id`: allí `req.user` es opcional para TypeScript aunque el guard ya lo haya llenado. Si por un error de configuración no hubiera usuario, `get()` lanza un error claro en lugar de dejar pasar un `undefined`.

Cada petición tiene su propio valor: dos peticiones simultáneas nunca ven el usuario de la otra. Las claves de contexto se explican en detalle en el [ciclo de vida de una petición](../request-lifecycle/#el-contexto-de-la-petición).

:::caution
En una ruta `@Public()` el guard de autenticación no se ejecuta, así que `CURRENT_USER` no tiene valor aunque la petición traiga una sesión válida. `CURRENT_USER.get()` lanza un error si no hay valor; en código que también corre en rutas públicas, usa `CURRENT_USER.find()`, que devuelve `undefined`.
:::

## Guards por ruta

Saber quién eres no basta para todo. Para comprobar permisos, añade guards con `@UseGuards()`:

```ts title="src/auth/admin.guard.ts"
import { Injectable, type CanActivate } from 'viga';
import { CURRENT_USER } from './current-user.ts';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate() {
    return CURRENT_USER.get().role === 'admin';
  }
}
```

```ts title="src/books/books.controller.ts"
@Delete('/:id')
@UseGuards(AdminGuard)
remove({ params }: HttpContext) {
  this.books.remove(Number(params.id));
}
```

Si un guard de `@UseGuards()` devuelve `false`, viga responde **403**, no 401: el usuario está autenticado, pero no tiene permiso. Como el guard de autenticación ya se ejecutó, `AdminGuard` puede usar `CURRENT_USER.get()` con seguridad.

`@UseGuards()` también va sobre la clase, y entonces protege todas las rutas del controlador. Acepta varios guards, que se ejecutan en orden: `@UseGuards(AdminGuard, ActiveAccountGuard)`.

### Guards como funciones

Si el guard no necesita providers, puede ser una función:

```ts
const isAdmin = () => CURRENT_USER.get().role === 'admin';

@UseGuards(isAdmin)
```

Funciona igual que la clase. Usa una clase cuando necesites `inject()`.

### Otra respuesta que no sea 403

Si quieres responder con otro código, lanza una excepción en lugar de devolver `false`. viga responde con la excepción que lances:

```ts
canActivate() {
  if (this.maintenance.isActive()) throw new ServiceUnavailableException();
  return CURRENT_USER.get().role === 'admin';
}
```

### Crea tus propios decoradores

Si repites la misma combinación de guards en varias rutas, agrúpala en una función que devuelva `UseGuards()`:

```ts title="src/auth/admin-only.ts"
import { UseGuards } from 'viga';
import { ActiveAccountGuard } from './active-account.guard.ts';
import { AdminGuard } from './admin.guard.ts';

export const AdminOnly = () => UseGuards(ActiveAccountGuard, AdminGuard);
```

```ts title="src/books/books.controller.ts"
@Delete('/:id')
@AdminOnly()
remove({ params }: HttpContext) {
  this.books.remove(Number(params.id));
}
```

Funciona sobre el método y sobre la clase, igual que `@UseGuards()`.

Si el decorador necesita parámetros, la función los recibe y crea el guard con ellos:

```ts title="src/auth/roles.ts"
import { UseGuards } from 'viga';
import { CURRENT_USER, type User } from './current-user.ts';

export const Roles = (...roles: User['role'][]) =>
  UseGuards(() => roles.includes(CURRENT_USER.get().role));
```

```ts
@Post()
@Roles('admin', 'editor')
create({ body }: HttpContext<{ body: typeof CreateBook }>) {
  return this.books.create(body);
}
```

Si además el guard necesita providers, crea la clase dentro de la función. Cada llamada crea su propia clase con los parámetros que recibió, y esa clase puede usar `inject()`:

```ts title="src/billing/require-plan.guard.ts"
import { Injectable, inject, type CanActivate } from 'viga';
import { CURRENT_USER } from '../auth/current-user.ts';
import { BillingService, type Plan } from './billing.service.ts';

export function RequirePlan(plan: Plan) {
  @Injectable()
  class RequirePlanGuard implements CanActivate {
    private readonly billing = inject(BillingService);

    async canActivate() {
      return (await this.billing.planOf(CURRENT_USER.get().id)) === plan;
    }
  }
  return RequirePlanGuard;
}
```

Se combina con otros guards igual que cualquier otro:

```ts title="src/billing/pro-only.ts"
import { UseGuards } from 'viga';
import { ActiveAccountGuard } from '../auth/active-account.guard.ts';
import { RequirePlan } from './require-plan.guard.ts';

export const ProOnly = () => UseGuards(ActiveAccountGuard, RequirePlan('pro'));
```

Y si quieres que el plan lo elija cada ruta, pásalo desde el decorador: `export const PlanOnly = (plan: Plan) => UseGuards(ActiveAccountGuard, RequirePlan(plan))`, y en la ruta `@PlanOnly('pro')`.

Estos decoradores son funciones normales, así que reciben cualquier valor: arrays, si defines `Roles` como `(roles: User['role'][]) => ...` y lo usas con `@Roles(['admin', 'editor'])`, u objetos de opciones, como `RequirePlan({ plan: 'pro', allowTrial: true })`. Un objeto conviene cuando hay varios parámetros o alguno es opcional, porque se entiende sin mirar la definición.

:::caution
Los argumentos del decorador se evalúan una sola vez, al cargar la clase, no en cada petición. Pasa solo valores fijos. Lo que depende de la petición, como el usuario, los parámetros o las cabeceras, se lee dentro de `canActivate`.
:::

Si vienes de NestJS, esto reemplaza a `applyDecorators()` y a la combinación de `@SetMetadata()` con un guard que lee los roles. En viga el guard recibe los roles directamente y lee el usuario de `CURRENT_USER`, así que no hacen falta metadatos aparte.

## El orden en que se ejecutan

Para una ruta privada, viga ejecuta los guards en este orden y se detiene en el primero que rechaza:

1. El guard de autenticación. Si rechaza: 401.
2. Los guards de `@UseGuards()` sobre la clase. Si alguno rechaza: 403.
3. Los guards de `@UseGuards()` sobre el método. Si alguno rechaza: 403.

En una ruta `@Public()` se salta solo el paso 1. Los guards de `@UseGuards()` se ejecutan igual: `@Public()` quita la autenticación, no los permisos.

## `@Public()` no se hereda

Si un controlador extiende a otro marcado con `@Public()`, el hijo es privado hasta que repita `@Public()`. Lo mismo pasa con un método que sobrescribe a otro público. Las rutas y los guards sí se heredan.

Así, extender una clase pública nunca abre rutas nuevas por accidente.

## Rutas que no existen

Cuando la app tiene un guard de autenticación, una ruta que no existe responde igual que una privada: 401 a quien no tiene sesión y 404 a quien sí la tiene. Así, quien no está autenticado no puede averiguar qué rutas existen probando URLs.

Este comportamiento se llama `concealRoutes` y se activa solo al usar `useAuthGuard()`. Puedes forzarlo con `createApp({ concealRoutes: true })` o desactivarlo con `false`.

## Revisa qué rutas son públicas

Al arrancar, viga lista las rutas públicas en el log, con nivel `debug`:

```txt
Public routes: GET /api/books, POST /api/auth/login
```

Revísala antes de cada despliegue: es la lista de todo lo que cualquiera puede llamar sin autenticarse.
