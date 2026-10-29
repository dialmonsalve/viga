---
title: Exceções
description: Como responder com um erro HTTP lançando uma exceção, o formato do corpo de erro, as mensagens próprias e o que acontece com os erros inesperados.
sidebar:
  order: 6
---

Para responder com um erro, lance uma exceção. Você pode fazer isso a partir de um controller, um serviço, um guard ou um interceptor: o viga a captura e a converte em uma resposta HTTP com um corpo JSON.

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

O serviço não precisa saber nada de HTTP além da exceção. O controller também não precisa de um `try/catch`.

## O corpo de erro

Todas as respostas de erro têm o mesmo formato:

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

| Campo | O que contém |
| --- | --- |
| `statusCode` | O código HTTP da resposta. |
| `code` | Um identificador estável do erro, pensado para que o frontend decida o que fazer. |
| `message` | Um texto para mostrar à pessoa. |
| `error` | O nome do código HTTP. |
| `details` | Só em alguns erros: informações adicionais, como os campos que falharam em uma validação. |
| `requestId` | O id da requisição, o mesmo do cabeçalho `X-Request-Id`. |
| `timestamp` | Quando aconteceu, em formato ISO. |

Use `code`, e não `message`, para tomar decisões no frontend: `message` pode mudar de texto ou de idioma, `code` não.

## As exceções disponíveis

| Exceção | Código HTTP | `code` padrão |
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

Todas são importadas de `viga`. Sem argumentos, usam o `code` padrão e sua mensagem em inglês.

## Seus próprios códigos e mensagens

O primeiro argumento de uma exceção é o `code`, e o segundo, parâmetros opcionais para a mensagem:

```ts
throw new NotFoundException('books.notFound', { id });
```

O viga precisa saber qual texto corresponde a `books.notFound`. Você informa isso com `resolveMessage`, uma opção de `createApp` que recebe o código, os parâmetros e a requisição, e devolve a mensagem:

```ts title="src/main.ts"
const messages: Record<string, string> = {
  'books.notFound': 'O livro {id} não existe',
};

const app = createApp({
  rootModule: AppModule,
  resolveMessage: (code, params) =>
    messages[code]?.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name])),
});
```

A resposta fica assim:

```json
{ "statusCode": 404, "code": "books.notFound", "message": "O livro 7 não existe", "error": "Not Found" }
```

Se `resolveMessage` devolver `undefined`, o viga usa sua mensagem em inglês para os próprios códigos (`errors.*`). Como `resolveMessage` recebe a requisição, também pode escolher o idioma pelo cabeçalho `Accept-Language`; `viga/i18n` faz exatamente isso, e você verá na página dele.

:::caution
Se o viga não encontrar uma mensagem para um `code`, ele o trata como texto livre: coloca-o como está em `message` e usa o `code` padrão do status. `new NotFoundException('books.notFound')` sem `resolveMessage` responde com `"message": "books.notFound"`, que não é um texto para mostrar a ninguém. Defina a mensagem de cada código próprio que você usar.
:::

Essa regra também permite escrever a mensagem diretamente, sem código próprio: `new NotFoundException('O livro não existe')` responde com esse texto e `"code": "errors.notFound"`. É útil para começar, mas um código próprio dá ao frontend algo estável com que trabalhar.

### Detalhes adicionais

`BadRequestException` aceita um segundo argumento com detalhes, que vão em `details`:

```ts
throw new BadRequestException('books.invalidIsbn', { field: 'isbn' });
```

É o que `@Validate` usa para listar os campos que não cumprem o schema.

## Suas próprias exceções

Se você repete o mesmo erro em vários lugares, crie uma classe que estenda a exceção adequada:

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

## Erros inesperados

Qualquer erro que não seja uma exceção do viga, como um `TypeError` ou um erro do banco de dados, responde 500 com uma mensagem genérica:

```json
{ "statusCode": 500, "code": "errors.internal", "message": "An unexpected error occurred", "error": "Internal Server Error" }
```

A mensagem original nunca chega ao cliente, porque pode conter detalhes internos como nomes de tabelas, caminhos de arquivos ou dados de conexão. O viga a escreve no log junto com o `requestId`. Se alguém relatar um erro, peça o `requestId` da resposta e procure-o no log.

Se você quiser que alguns desses erros respondam outra coisa, por exemplo um duplicado no banco de dados como 409, traduza-os com um [interceptor](../interceptors/#traduza-erros).

## Erros que o viga já reconhece

Alguns erros não são lançados por você, mas o viga sabe respondê-los bem. Por exemplo, um corpo JSON malformado responde 400 e um grande demais, 413, em vez de 500.

Se um método falhar depois de começar a enviar a resposta, por exemplo no meio de um arquivo, o viga já não pode mudar o código de status. Nesse caso ele escreve o erro no log e fecha a conexão, para que o cliente saiba que a resposta ficou incompleta.
