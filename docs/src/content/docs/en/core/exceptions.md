---
title: Exceptions
description: How to respond with an HTTP error by throwing an exception, the error body format, your own messages and what happens with unexpected errors.
sidebar:
  order: 6
---

To respond with an error, throw an exception. You can do it from a controller, a service, a guard or an interceptor: viga catches it and turns it into an HTTP response with a JSON body.

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

The service doesn't need to know anything about HTTP beyond the exception. The controller doesn't need a `try/catch` either.

## The error body

Every error response has the same format:

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

| Field | What it holds |
| --- | --- |
| `statusCode` | The HTTP status code of the response. |
| `code` | A stable identifier of the error, meant for the frontend to decide what to do. |
| `message` | A text to show to the person. |
| `error` | The name of the HTTP status code. |
| `details` | Only on some errors: extra information, like the fields that failed a validation. |
| `requestId` | The request id, the same as the `X-Request-Id` header. |
| `timestamp` | When it happened, in ISO format. |

Use `code`, not `message`, to make decisions in the frontend: `message` can change wording or language, `code` doesn't.

## The available exceptions

| Exception | HTTP status | Default `code` |
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

All of them are imported from `viga`. With no arguments, they use the default `code` and its English message.

### Other status codes

For an HTTP status that isn't in the table, like 402 or 422, use `HttpException` with the status, the `code` and the status name:

```ts
import { HttpException } from 'viga';

throw new HttpException(402, 'billing.paymentRequired', 'Payment Required');
```

Define its message in `resolveMessage`, like any code of your own. If you don't, viga treats the `code` as free text and uses `errors.badRequest` for 4xx statuses and `errors.internal` for 5xx.

## Your own codes and messages

The first argument of an exception is the `code`, and the second, optional parameters for the message:

```ts
throw new NotFoundException('books.notFound', { id });
```

viga needs to know which text goes with `books.notFound`. You tell it with `resolveMessage`, a `createApp` option that receives the code, the parameters and the request, and returns the message:

```ts title="src/main.ts"
const messages: Record<string, string> = {
  'books.notFound': 'Book {id} does not exist',
};

const app = createApp({
  rootModule: AppModule,
  resolveMessage: (code, params) =>
    messages[code]?.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name])),
});
```

The response looks like this:

```json
{ "statusCode": 404, "code": "books.notFound", "message": "Book 7 does not exist", "error": "Not Found" }
```

If `resolveMessage` returns `undefined`, viga uses its English message for its own codes (`errors.*`). Since `resolveMessage` receives the request, it can also pick the language from the `Accept-Language` header; `viga/i18n` does exactly that, and you'll see it on its page.

:::caution
If viga finds no message for a `code`, it treats it as free text: it puts it as-is in `message` and uses the status's default `code`. `new NotFoundException('books.notFound')` without `resolveMessage` responds with `"message": "books.notFound"`, which isn't a text to show anyone. Define the message for every code of your own that you use.
:::

That rule also lets you write the message directly, with no code of your own: `new NotFoundException('Book not found')` responds with that text and `"code": "errors.notFound"`. It's handy to start with, but a code of your own gives the frontend something stable to work with.

### Extra details

`BadRequestException` accepts a second argument with details, which go in `details`:

```ts
throw new BadRequestException('books.invalidIsbn', { field: 'isbn' });
```

That is what `@Validate` uses to list the fields that don't match the schema.

## Your own exceptions

If you repeat the same error in several places, create a class that extends the right exception:

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

## Unexpected errors

Any error that isn't a viga exception, like a `TypeError` or a database error, responds 500 with a generic message:

```json
{ "statusCode": 500, "code": "errors.internal", "message": "An unexpected error occurred", "error": "Internal Server Error" }
```

The original message never reaches the client, because it may contain internal details like table names, file paths or connection data. viga writes it to the log together with the `requestId`. If someone reports an error, ask them for the response's `requestId` and look it up in the log.

If you want some of those errors to respond differently, for example a database duplicate as 409, translate them with an [interceptor](../interceptors/#translate-errors).

## Errors viga already recognizes

Some errors aren't thrown by you, but viga knows how to answer them properly. For example, a malformed JSON body responds 400 and one that is too large, 413, instead of 500.

If a method fails after it started sending the response, for example halfway through a file, viga can no longer change the status code. In that case it writes the error to the log and closes the connection, so the client knows the response is incomplete.
