---
title: Excepciones
description: Cómo responder con un error HTTP lanzando una excepción, el formato del cuerpo de error, los mensajes propios y qué pasa con los errores inesperados.
sidebar:
  order: 6
---

Para responder con un error, lanza una excepción. Puedes hacerlo desde un controlador, un servicio, un guard o un interceptor: viga la captura y la convierte en una respuesta HTTP con un cuerpo JSON.

```ts title="src/books/books.service.ts"
import { Injectable, NotFoundException } from 'viga';

@Injectable()
export class BooksService {
  findOne(id: number) {
    const book = this.books.find((book) => book.id === id);
    if (!book) throw new NotFoundException();
    return book;
  }
}
```

El servicio no necesita saber nada de HTTP más allá de la excepción. El controlador tampoco necesita un `try/catch`.

## El cuerpo de error

Todas las respuestas de error tienen el mismo formato:

```json
{
  "statusCode": 404,
  "code": "errors.notFound",
  "message": "The requested resource does not exist",
  "error": "Not Found",
  "requestId": "3f1c9e0a-6b2d-4c1e-9a57-0d4b8e2f7c11",
  "timestamp": "2026-10-28T12:00:00.000Z"
}
```

| Campo | Qué contiene |
| --- | --- |
| `statusCode` | El código HTTP de la respuesta. |
| `code` | Un identificador estable del error, pensado para que el frontend decida qué hacer. |
| `message` | Un texto para mostrar a la persona. |
| `error` | El nombre del código HTTP. |
| `details` | Solo en algunos errores: información adicional, como los campos que fallaron en una validación. |
| `requestId` | El id de la petición, el mismo de la cabecera `X-Request-Id`. |
| `timestamp` | Cuándo ocurrió, en formato ISO. |

Usa `code` y no `message` para tomar decisiones en el frontend: `message` puede cambiar de texto o de idioma, `code` no.

## Las excepciones disponibles

| Excepción | Código HTTP | `code` por defecto |
| --- | --- | --- |
| `BadRequestException` | 400 | `errors.badRequest` |
| `UnauthorizedException` | 401 | `errors.unauthorized` |
| `ForbiddenException` | 403 | `errors.forbidden` |
| `NotFoundException` | 404 | `errors.notFound` |
| `ConflictException` | 409 | `errors.conflict` |
| `PayloadTooLargeException` | 413 | `errors.payloadTooLarge` |
| `UnsupportedMediaTypeException` | 415 | `errors.unsupportedMediaType` |
| `TooManyRequestsException` | 429 | `errors.tooManyRequests` |
| `InternalServerErrorException` | 500 | `errors.internal` |
| `ServiceUnavailableException` | 503 | `errors.serviceUnavailable` |

Todas se importan de `viga`. Sin argumentos, usan el `code` por defecto y su mensaje en inglés.

### Otros códigos de estado

Para un código HTTP que no está en la tabla, como 402 o 422, usa `HttpException` con el estado, el `code` y el nombre del estado:

```ts
import { HttpException } from 'viga';

throw new HttpException(402, 'billing.paymentRequired', 'Payment Required');
```

Define su mensaje en `resolveMessage`, como cualquier código propio. Si no lo haces, viga trata el `code` como texto libre y usa `errors.badRequest` para los estados 4xx y `errors.internal` para los 5xx.

## Tus propios códigos y mensajes

El primer argumento de una excepción es el `code`, y el segundo, parámetros opcionales para el mensaje:

```ts
throw new NotFoundException('books.notFound', { id });
```

viga necesita saber qué texto corresponde a `books.notFound`. Se lo dices con `resolveMessage`, una opción de `createApp` que recibe el código, los parámetros y la petición, y devuelve el mensaje:

```ts title="src/main.ts"
const messages: Record<string, string> = {
  'books.notFound': 'El libro {id} no existe',
};

const app = createApp({
  rootModule: AppModule,
  resolveMessage: (code, params) =>
    messages[code]?.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name])),
});
```

La respuesta queda así:

```json
{ "statusCode": 404, "code": "books.notFound", "message": "El libro 7 no existe", "error": "Not Found" }
```

Si `resolveMessage` devuelve `undefined`, viga usa su mensaje en inglés para sus propios códigos (`errors.*`). Como `resolveMessage` recibe la petición, también puede elegir el idioma según la cabecera `Accept-Language`; `viga/i18n` hace exactamente eso, y lo verás en su página.

:::caution
Si viga no encuentra un mensaje para un `code`, lo trata como texto libre: lo pone tal cual en `message` y usa el `code` por defecto del estado. `new NotFoundException('books.notFound')` sin `resolveMessage` responde con `"message": "books.notFound"`, que no es un texto para mostrar a nadie. Define el mensaje de cada código propio que uses.
:::

Esa regla también permite escribir el mensaje directamente, sin código propio: `new NotFoundException('El libro no existe')` responde con ese texto y `"code": "errors.notFound"`. Es útil para empezar, pero un `code` propio le da al frontend algo estable con lo que trabajar.

### Detalles adicionales

`BadRequestException` acepta un segundo argumento con detalles, que van en `details`:

```ts
throw new BadRequestException('books.invalidIsbn', { field: 'isbn' });
```

Es lo que usa `@Validate` para listar los campos que no cumplen el esquema.

## Tus propias excepciones

Si repites el mismo error en varios lugares, crea una clase que extienda la excepción adecuada:

```ts title="src/books/book-not-found.exception.ts"
import { NotFoundException } from 'viga';

export class BookNotFoundException extends NotFoundException {
  constructor(id: number) {
    super('books.notFound', { id });
  }
}
```

```ts
if (!book) throw new BookNotFoundException(id);
```

## Errores inesperados

Cualquier error que no sea una excepción de viga, como un `TypeError` o un error de la base de datos, responde 500 con un mensaje genérico:

```json
{ "statusCode": 500, "code": "errors.internal", "message": "An unexpected error occurred", "error": "Internal Server Error" }
```

El mensaje original nunca llega al cliente, porque puede contener detalles internos como nombres de tablas, rutas de archivos o datos de conexión. viga lo escribe en el log junto con el `requestId`. Si alguien reporta un error, pídele el `requestId` de la respuesta y búscalo en el log.

Si quieres que algunos de esos errores respondan otra cosa, por ejemplo un duplicado en la base de datos como 409, tradúcelos con un [interceptor](../interceptors/#traduce-errores).

## Errores que viga ya reconoce

Algunos errores no los lanzas tú, pero viga sabe responderlos bien. Por ejemplo, un cuerpo JSON mal formado responde 400 y uno demasiado grande, 413, en lugar de 500.

Si un método falla después de empezar a enviar la respuesta, por ejemplo a mitad de un archivo, viga ya no puede cambiar el código de estado. En ese caso escribe el error en el log y cierra la conexión, para que el cliente sepa que la respuesta quedó incompleta.
