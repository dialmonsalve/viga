---
title: Providers e inyección de dependencias
description: Qué es un provider, cómo se pide con inject(), las cuatro formas de declararlo y los errores que viga detecta al arrancar.
sidebar:
  order: 2
---

Un provider es algo que el contenedor de viga crea y entrega a quien lo pida: un servicio, un repositorio, un valor de configuración. En lugar de que cada clase cree lo que necesita con `new`, lo pide con `inject()` y el contenedor decide qué entregar.

Eso trae dos ventajas. Cada provider se crea una sola vez y se comparte, y puedes reemplazar uno por otro sin tocar a quien lo usa, como viste en [repositorios](../../start/repositories/).

## Declara y pide un provider

Una clase se convierte en provider con `@Injectable()` y declarándola en `providers` de un módulo:

```ts title="src/clock/clock.ts"
import { Injectable } from 'viga';

@Injectable()
export class Clock {
  now() {
    return new Date();
  }
}
```

```ts title="src/books/books.module.ts"
import { Module } from 'viga';
import { Clock } from '../clock/clock.ts';
import { BooksController } from './books.controller.ts';
import { BooksService } from './books.service.ts';

@Module({
  controllers: [BooksController],
  providers: [BooksService, Clock],
})
export class BooksModule {}
```

Otra clase del módulo lo pide con `inject()` en un campo:

```ts title="src/books/books.service.ts"
import { Injectable, inject } from 'viga';
import { Clock } from '../clock/clock.ts';

@Injectable()
export class BooksService {
  private readonly clock = inject(Clock);

  findAll() {
    return { books: [], generatedAt: this.clock.now() };
  }
}
```

`inject(Clock)` devuelve una instancia con el tipo `Clock`, sin anotaciones extra. Los controladores piden providers de la misma forma, aunque no se declaran en `providers` sino en `controllers`.

## Por qué `inject()` y no el constructor

Los decoradores estándar de JavaScript, que son los que usa viga, no exponen los tipos de los parámetros del constructor. Por eso viga no puede saber qué pide un constructor y las dependencias se piden de forma explícita con `inject()`. A cambio, no necesitas `reflect-metadata` ni `emitDecoratorMetadata`.

Si vienes de NestJS: allí las dependencias llegan por el constructor porque TypeScript emite sus tipos con `emitDecoratorMetadata` y NestJS los lee con `reflect-metadata`.

`inject()` solo funciona mientras el contenedor construye la clase: en la inicialización de un campo, como arriba, o dentro del constructor. Si lo llamas después, por ejemplo dentro de un método, falla:

```txt
[DI] inject(Clock) can only be called while the container is constructing a class
```

La solución es pedir la dependencia en un campo y usarla desde el método.

## Las cuatro formas de declarar un provider

| Forma | Quién crea el objeto | Cuándo usarla |
| --- | --- | --- |
| `Clock` | El contenedor, con `new Clock()` | La forma corta de `{ provide: Clock, useClass: Clock }`. Es la habitual para tus servicios. |
| `{ provide: TOKEN, useClass: Clase }` | El contenedor, con `new Clase()` | El token es distinto de la clase, por ejemplo una interfaz con varias implementaciones. |
| `{ provide: TOKEN, useValue: valor }` | Nadie: ya existe | El valor ya está hecho, como un objeto de opciones o una instancia creada en otro lugar. |
| `{ provide: TOKEN, useFactory: () => valor }` | Tu función, una vez al arrancar | Hay que pasar argumentos al constructor, la clase no es tuya o el valor depende de lógica. |

`provide` puede ser una clase o un `InjectionToken`. Las clases que entregues con la forma corta o con `useClass` necesitan `@Injectable()`; si falta, viga no arranca:

```txt
[DI] Clock must be decorated with @Injectable()
```

### `useClass`: elegir una implementación

Asocia un token a una clase: cuando alguien pida el token, el contenedor crea esa clase. La forma corta que usaste hasta ahora es un caso de `useClass` en el que el token y la clase son la misma:

```ts
providers: [Clock]
providers: [{ provide: Clock, useClass: Clock }]
```

Las dos líneas hacen lo mismo. La forma larga tiene sentido cuando el token es distinto de la clase, normalmente un `InjectionToken` que representa una interfaz. Es lo que hiciste en [repositorios](../../start/repositories/):

```ts
providers: [{ provide: BOOKS_REPOSITORY, useClass: InMemoryBooksRepository }]
```

Quien pide `inject(BOOKS_REPOSITORY)` recibe un `InMemoryBooksRepository`. Para pasar a una base de datos, cambias solo la clase.

### `useValue`: entregar un valor ya hecho

Sirve para valores que no necesitan construirse, como un objeto de opciones:

```ts title="src/books/books.options.ts"
import { InjectionToken } from 'viga';

export interface BooksOptions {
  pageSize: number;
}

export const BOOKS_OPTIONS = new InjectionToken<BooksOptions>('BOOKS_OPTIONS');
```

```ts title="src/books/books.module.ts"
providers: [BooksService, { provide: BOOKS_OPTIONS, useValue: { pageSize: 20 } }],
```

`inject(BOOKS_OPTIONS)` devuelve el objeto con el tipo `BooksOptions`.

### `useFactory`: construir el valor con código

Sirve para crear objetos de clases que no son tuyas y no tienen `@Injectable()`, como el cliente de una librería. La función se ejecuta una sola vez y puede usar `inject()` para pedir otros providers:

```ts title="src/search/search.module.ts"
import { LOGGER, Module, inject } from 'viga';
import { SearchClient } from 'some-search-library';
import { SEARCH_CLIENT } from './search.client.ts';

@Module({
  providers: [
    {
      provide: SEARCH_CLIENT,
      useFactory: () => new SearchClient({ url: 'http://localhost:7700', logger: inject(LOGGER) }),
    },
  ],
  exports: [SEARCH_CLIENT],
})
export class SearchModule {}
```

`SEARCH_CLIENT` es un `InjectionToken<SearchClient>` declarado en `search.client.ts`, y `some-search-library` representa la librería que uses.

La función debe devolver el valor directamente, no una promesa. Si necesitas trabajo asíncrono al arrancar, como conectarte a una base de datos, hazlo en el hook `onModuleInit` del provider, que verás en el [ciclo de vida de la app](../app-lifecycle/#los-hooks-de-los-providers).

## Cuándo se crean

viga crea todos los providers al arrancar, antes de abrir el puerto, y cada uno una sola vez por módulo. Si un provider falla al construirse o le falta una dependencia, lo sabes al iniciar la app y no con la primera petición.

Si un provider pide otro que todavía no existe, viga lo crea en ese momento y se lo entrega.

## Providers que viga ya trae

Algunos providers están disponibles en todos los módulos sin declararlos. El más útil es `LOGGER`, el logger de la app:

```ts title="src/books/books.service.ts"
import { Injectable, LOGGER, inject } from 'viga';

@Injectable()
export class BooksService {
  private readonly logger = inject(LOGGER);

  findAll() {
    this.logger.info('Listando libros');
    return [];
  }
}
```

Tiene los métodos `info`, `warn`, `error` y `debug`.

## Dependencias circulares

Si `BooksService` pide `ReviewsService` y `ReviewsService` pide `BooksService`, ninguno puede crearse primero. viga lo detecta al arrancar y muestra la cadena:

```txt
[DI] Circular dependency in BooksModule: BooksService -> ReviewsService -> BooksService
```

viga no ofrece una forma de saltarse este error. Casi siempre significa que los dos servicios comparten una responsabilidad que debería vivir en un tercer provider del que dependan ambos.

No es lo mismo que una [importación circular](../modules/#errores-al-cargar-los-módulos), que ocurre entre módulos y no entre providers.
