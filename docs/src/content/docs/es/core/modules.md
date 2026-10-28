---
title: Módulos
description: Cómo viga organiza la app en módulos, qué ve cada uno, cómo comparten providers y cuándo usar un módulo global.
sidebar:
  order: 1
---

Un módulo reúne los controladores y providers de una funcionalidad. La app es un árbol de módulos: el módulo raíz, el que pasas a `createApp`, importa a los demás, y cada uno puede importar otros.

En la [primera app](../../start/first-app/) ya escribiste dos: `BooksModule` y `AppModule`. Esta página explica qué pasa entre ellos.

## Las opciones de `@Module`

| Opción | Para qué sirve |
| --- | --- |
| `imports` | Módulos cuyos providers exportados quieres usar. |
| `controllers` | Controladores del módulo. viga registra sus rutas. |
| `providers` | Clases y valores que el módulo crea y puede inyectar. |
| `exports` | Providers del módulo que otros módulos pueden usar al importarlo. |
| `global` | Hace que sus exports estén disponibles en toda la app. Lo ves más abajo. |

Todas son opcionales. Un módulo sin opciones, `@Module({})`, es válido aunque no aporta nada.

## Cada módulo es privado por defecto

Cada módulo tiene su propio contenedor. Un provider declarado en `providers` solo lo pueden inyectar las clases de ese mismo módulo, a menos que lo exportes.

Supón que agregas autores a la app y quieres que `BooksService` use `AuthorsService`:

```ts title="src/authors/authors.module.ts"
import { Module } from 'viga';
import { AuthorsService } from './authors.service.ts';

@Module({
  providers: [AuthorsService],
})
export class AuthorsModule {}
```

```ts title="src/books/books.module.ts"
import { Module } from 'viga';
import { AuthorsModule } from '../authors/authors.module.ts';
import { BooksController } from './books.controller.ts';
import { BooksService } from './books.service.ts';

@Module({
  imports: [AuthorsModule],
  controllers: [BooksController],
  providers: [BooksService],
})
export class BooksModule {}
```

Aunque `BooksModule` importa `AuthorsModule`, la app no arranca:

```txt
[DI] BooksModule cannot resolve AuthorsService: it is missing from providers or from the exports of an imported module
```

`AuthorsService` existe, pero es privado de `AuthorsModule`. Importar un módulo solo da acceso a lo que exporta.

## Exporta lo que otros necesitan

Agrega `AuthorsService` a `exports`:

```ts title="src/authors/authors.module.ts" ins={6}
import { Module } from 'viga';
import { AuthorsService } from './authors.service.ts';

@Module({
  providers: [AuthorsService],
  exports: [AuthorsService],
})
export class AuthorsModule {}
```

Ahora `BooksService` puede pedirlo con `inject(AuthorsService)`. Lo que no exportes sigue siendo un detalle interno del módulo: puedes cambiarlo sin romper a nadie.

Solo exportas providers que el módulo declara o que recibe de sus imports. Los controladores no se exportan: sus rutas se registran igual, sin importar quién importe el módulo.

## Una sola instancia por provider

viga carga cada módulo una sola vez, aunque lo importen varios. Si `BooksModule` y `ReviewsModule` importan `AuthorsModule`, los dos reciben la misma instancia de `AuthorsService`.

Dentro de un módulo, cada provider se crea la primera vez que alguien lo pide y después se reutiliza. Por eso un provider puede guardar estado, como la lista de libros en memoria de la primera app.

:::caution
Si declaras la misma clase en `providers` de dos módulos distintos, cada módulo crea su propia instancia y el estado no se comparte. Para compartir un provider, decláralo en un módulo, expórtalo e importa ese módulo donde lo necesites.
:::

## Reexporta módulos

Un módulo puede exportar un módulo que importa. Así, quien lo importe recibe también los exports de ese otro módulo:

```ts title="src/shared/shared.module.ts"
import { Module } from 'viga';
import { AuthorsModule } from '../authors/authors.module.ts';
import { PublishersModule } from '../publishers/publishers.module.ts';

@Module({
  imports: [AuthorsModule, PublishersModule],
  exports: [AuthorsModule, PublishersModule],
})
export class SharedModule {}
```

Importar `SharedModule` equivale a importar `AuthorsModule` y `PublishersModule`. Sirve para agrupar módulos que casi siempre se usan juntos.

## Módulos globales

Algunos providers los necesita casi toda la app, como la configuración. Importar su módulo en cada sitio sería repetitivo; con `global: true`, sus exports están disponibles en todos los módulos sin importarlo:

```ts title="src/clock/clock.module.ts"
import { Module } from 'viga';
import { Clock } from './clock.ts';

@Module({
  global: true,
  providers: [Clock],
  exports: [Clock],
})
export class ClockModule {}
```

Un módulo global se importa una vez, en el módulo raíz:

```ts title="src/app.module.ts"
import { Module } from 'viga';
import { BooksModule } from './books/books.module.ts';
import { ClockModule } from './clock/clock.module.ts';

@Module({ imports: [ClockModule, BooksModule] })
export class AppModule {}
```

Si lo importas desde otro módulo, viga no arranca y te dice dónde moverlo:

```txt
[Module] ClockModule is global and is imported from BooksModule, but not from the root module; move it to the imports of AppModule
```

Esta regla hace que todos los módulos globales se vean en un solo archivo. `ConfigModule.forRoot()`, de `viga/config`, es un módulo global y se importa así.

:::tip
Usa módulos globales solo para lo que de verdad es transversal. Un import explícito deja claro de qué depende cada módulo; un global lo oculta.
:::

## Dónde busca viga un provider

Cuando una clase pide un provider con `inject()`, viga lo busca en este orden y usa el primero que encuentra:

1. Los `providers` del propio módulo.
2. Los `exports` de los módulos que importa, incluidos los que estos reexportan.
3. Los `exports` de los módulos globales.

Si no aparece en ninguno, la app no arranca y el error nombra el módulo y el provider que falta.

## Errores al cargar los módulos

viga revisa el árbol de módulos al arrancar y falla antes de abrir el puerto:

- **Importación circular.** Si `BooksModule` importa `AuthorsModule` y `AuthorsModule` importa `BooksModule`, el error muestra la cadena desde el módulo raíz: `[Module] Circular import: AppModule -> BooksModule -> AuthorsModule -> BooksModule`. Suele indicar que hay un provider que debería vivir en un tercer módulo que los dos importen.
- **Clase sin `@Module()`.** Si pones en `imports` una clase que no es un módulo: `[Module] AuthorsService must be decorated with @Module()`.
