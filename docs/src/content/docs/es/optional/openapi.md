---
title: viga/openapi
description: Genera un documento OpenAPI 3.1 a partir de tus rutas y decoradores, para Scalar o cualquier otra herramienta, sin escribirlo a mano.
head:
  - tag: title
    content: 'Documentación OpenAPI en Node.js con viga/openapi'
sidebar:
  order: 13
---

`viga/openapi` genera un documento [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) a partir de lo que ya declaras en tus controladores, y lo sirve en `/openapi.json`. Como sale de tus decoradores, no se desactualiza como un archivo escrito a mano.

Es solo el documento. Para verlo como una página y probar tu API, usa la herramienta que prefieras, como [Scalar](../../guides/scalar/).

## Actívalo

```ts title="src/app.module.ts"
import { Module } from 'viga';
import { OpenApiModule } from 'viga/openapi';
import { BooksModule } from './books/books.module.ts';

@Module({
  imports: [
    OpenApiModule.forRoot(
      {
        title: 'API de libros',
        version: '1.0.0',
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      },
      { public: process.env.NODE_ENV !== 'production' }
    ),
    BooksModule,
  ],
})
export class AppModule {}
```

| Opción | Por defecto | Qué hace |
| --- | --- | --- |
| `title`, `version` | Obligatorias | Los datos del documento. |
| `description` | Sin descripción | Un texto de introducción. |
| `securitySchemes` | Ninguno | Cómo se autentican las rutas privadas. Si lo omites, el documento no indica cómo hacerlo. |

Si las opciones dependen de otros providers, `forRoot` también acepta una función, que puede usar `inject()` como en [`viga/health`](../health/#añade-las-rutas).

## Quién puede leerlo

El documento revela todas tus rutas, así que es **privado por defecto**: pasa por tu [guard de autenticación](../../core/guards/#el-guard-de-autenticación) como cualquier otra ruta. Se abre en el segundo argumento, junto con su ruta:

```ts
OpenApiModule.forRoot(options, { path: '/docs.json', public: true });
```

Estas opciones van aparte porque viga tiene que conocerlas antes de crear los providers. Como las demás rutas, lleva el [`globalPrefix`](../../core/controllers/) de la app.

Una herramienta que se abre en el navegador no puede leer un documento privado, porque no envía tu token al pedirlo. Por eso el ejemplo solo lo abre fuera de producción.

## Lo que sale solo

Sin tocar tus controladores, el documento incluye:

| En el documento | De dónde sale |
| --- | --- |
| Rutas, métodos y prefijo | Las rutas que viga ha montado de verdad. |
| Parámetros y cuerpo | [`@Validate`](../validation/) |
| Respuesta 400 | Las rutas con `@Validate` o `@Upload`. |
| Quién puede acceder y respuesta 401 | [`@Public`](../../core/guards/#rutas-privadas-por-defecto) |
| Código de la respuesta correcta | [`@HttpCode`](../../core/controllers/). Si no lo hay, 201 en `POST` y 200 en el resto. |
| Respuesta 429 | [`@RateLimit`](../../security/rate-limiting/#por-ruta), en la ruta o en su controlador. |
| Cuerpo `multipart/form-data` y respuestas 413 y 415 | [`@Upload`](../upload/) |

Cada ruta se agrupa por el nombre de su controlador: `BooksController` queda en `Books`.

:::note
Un método que no devuelve nada responde 204, pero viga no puede saberlo antes de ejecutarlo, así que el documento dirá 200. Añade `@HttpCode(204)` para que coincidan.
:::

## Añade detalle con `@Docs`

`@Docs` es opcional:

```ts title="src/books/books.controller.ts"
import { Controller, Delete, Get, HttpCode, Post, type HttpContext } from 'viga';
import { Docs } from 'viga/openapi';
import { Validate } from 'viga/validation';
import { Book, BookParams } from './books.schemas.ts';

@Controller('/books')
export class BooksController {
  @Get('/:id')
  @Docs({ summary: 'Devuelve un libro', responses: { 200: Book, 404: 'El libro no existe' } })
  @Validate({ params: BookParams })
  findOne({ params }: HttpContext<{ params: typeof BookParams }>) {
    return { id: params.id, title: 'Dune' };
  }

  @Delete('/:id')
  @HttpCode(204)
  @Docs({ summary: 'Borra un libro', deprecated: true })
  remove() {}

  @Post('/import')
  @Docs({ hidden: true })
  import() {
    return { imported: true };
  }
}
```

| Campo | Qué hace |
| --- | --- |
| `summary`, `description` | Los textos de la ruta. |
| `tags` | Cómo se agrupa, en lugar del nombre del controlador. |
| `responses` | Las respuestas por código de estado. |
| `deprecated` | Marca la ruta como obsoleta. |
| `hidden` | La deja fuera del documento. La ruta sigue funcionando. |

Cada respuesta es un esquema o, si no hay un cuerpo que describir, un texto. Un texto en un código de error, como el `404` del ejemplo, usa el [formato de error de viga](../../core/exceptions/#el-cuerpo-de-error).

Sobre el controlador, `@Docs` aplica `tags`, `deprecated` y `hidden` a todas sus rutas, y lo que pongas en un método tiene prioridad.

:::caution
`responses` solo documenta. No valida ni filtra lo que responde la ruta, así que puede no coincidir con lo que devuelve tu método, y un campo que no aparezca en el esquema se sigue enviando.
:::

## Los esquemas

Los esquemas se convierten con `~standard.jsonSchema`, una extensión de Standard Schema, sin depender de una librería concreta:

| Librería | Qué hacer |
| --- | --- |
| Zod | Nada. |
| ArkType | Nada. |
| Valibot | Envuelve el esquema con `toStandardJsonSchema` de `@valibot/to-json-schema`. |

```ts
import { toStandardJsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';

export const CreateBook = toStandardJsonSchema(v.object({ title: v.string() }));
```

### Lo que no se puede convertir

Algunos esquemas no tienen equivalente en JSON Schema, como `z.date()`, o una librería puede no ofrecer la conversión. La app arranca igual: esa parte queda sin detallar en el documento, y viga lo avisa en el log una sola vez:

```txt
[OpenApi] POST /books body could not be converted to JSON Schema: Date cannot be represented in JSON Schema
```

Con un `transform`, el resultado no se puede describir, así que viga usa lo que el esquema acepta como entrada, o al revés en el cuerpo de una petición. Solo avisa si no puede con ninguno de los dos.

## Desde el código

`OpenApiService` devuelve el documento, por ejemplo para guardarlo en un archivo y generar un cliente en tu integración continua:

```ts title="src/export-openapi.ts"
import { writeFile } from 'node:fs/promises';
import { createApp } from 'viga';
import { OpenApiService } from 'viga/openapi';
import { AppModule } from './app.module.ts';

const app = await createApp({ rootModule: AppModule }).init();

await writeFile('openapi.json', JSON.stringify(app.get(OpenApiService).document(), null, 2));
await app.close();
```

`init()` crea todos los providers, así que este script necesita las mismas variables de entorno que la app, y se conecta a la base de datos si la usas.

## Lo que no cubre

- **WebSocket:** los [gateways](../websocket/) no aparecen, porque OpenAPI describe APIs HTTP.
- **Middlewares:** las rutas que añades con `app.use()` no aparecen, porque viga no las conoce.
- **Parámetros opcionales de Express:** una ruta como `/by/:year{/:month}` se documenta como `/by/{year}/{month}`, porque OpenAPI no tiene parámetros de ruta opcionales.
