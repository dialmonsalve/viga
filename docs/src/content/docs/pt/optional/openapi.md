---
title: viga/openapi
description: Gere um documento OpenAPI 3.1 a partir das suas rotas e decoradores, para o Scalar ou qualquer outra ferramenta, sem escrevê-lo à mão.
head:
  - tag: title
    content: 'Documentação OpenAPI em Node.js com viga/openapi'
sidebar:
  order: 13
---

`viga/openapi` gera um documento [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) a partir do que você já declara nos seus controllers, e o serve em `/openapi.json`. Como vem dos seus decoradores, ele não fica desatualizado como um arquivo escrito à mão.

É apenas o documento. Para vê-lo como uma página e testar sua API, use a ferramenta que preferir, como o [Scalar](../../guides/scalar/).

## Ative-o

```ts title="src/app.module.ts"
import { Module } from 'viga';
import { OpenApiModule } from 'viga/openapi';
import { BooksModule } from './books/books.module.ts';

@Module({
  imports: [
    OpenApiModule.forRoot(
      {
        title: 'API de livros',
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

| Opção | Padrão | O que faz |
| --- | --- | --- |
| `title`, `version` | Obrigatórias | Os dados do documento. |
| `description` | Sem descrição | Um texto de introdução. |
| `securitySchemes` | Nenhum | Como as rotas privadas se autenticam. Se você omitir, o documento não indica como fazer isso. |

Se as opções dependem de outros providers, `forRoot` também aceita uma função, que pode usar `inject()` como em [`viga/health`](../health/#adicione-as-rotas).

## Quem pode lê-lo

O documento revela todas as suas rotas, então é **privado por padrão**: passa pelo seu [guard de autenticação](../../core/guards/#o-guard-de-autenticação) como qualquer outra rota. Ele é aberto no segundo argumento, junto com sua rota:

```ts
OpenApiModule.forRoot(options, { path: '/docs.json', public: true });
```

Essas opções ficam à parte porque o viga precisa conhecê-las antes de criar os providers. Como as demais rotas, leva o [`globalPrefix`](../../core/controllers/) da aplicação.

Uma ferramenta que abre no navegador não pode ler um documento privado, porque não envia seu token ao pedi-lo. Por isso o exemplo só o abre fora de produção.

## O que sai sozinho

Sem tocar nos seus controllers, o documento inclui:

| No documento | De onde vem |
| --- | --- |
| Rotas, métodos e prefixo | As rotas que o viga realmente montou. |
| Parâmetros e corpo | [`@Validate`](../validation/) |
| Resposta 400 | As rotas com `@Validate` ou `@Upload`. |
| Quem pode acessar e resposta 401 | [`@Public`](../../core/guards/#rotas-privadas-por-padrão) |
| Código da resposta de sucesso | [`@HttpCode`](../../core/controllers/). Sem ele, 201 em `POST` e 200 no resto. |
| Resposta 429 | [`@RateLimit`](../../security/rate-limiting/#por-rota), na rota ou no controller dela. |
| Corpo `multipart/form-data` e respostas 413 e 415 | [`@Upload`](../upload/) |

Cada rota é agrupada pelo nome do seu controller: `BooksController` fica em `Books`.

:::note
Um método que não devolve nada responde 204, mas o viga não pode saber disso antes de executá-lo, então o documento dirá 200. Adicione `@HttpCode(204)` para que coincidam.
:::

## Adicione detalhes com `@Docs`

`@Docs` é opcional:

```ts title="src/books/books.controller.ts"
import { Controller, Delete, Get, HttpCode, Post, type HttpContext } from 'viga';
import { Docs } from 'viga/openapi';
import { Validate } from 'viga/validation';
import { Book, BookParams } from './books.schemas.ts';

@Controller('/books')
export class BooksController {
  @Get('/:id')
  @Docs({ summary: 'Devolve um livro', responses: { 200: Book, 404: 'O livro não existe' } })
  @Validate({ params: BookParams })
  findOne({ params }: HttpContext<{ params: typeof BookParams }>) {
    return { id: params.id, title: 'Dune' };
  }

  @Delete('/:id')
  @HttpCode(204)
  @Docs({ summary: 'Apaga um livro', deprecated: true })
  remove() {}

  @Post('/import')
  @Docs({ hidden: true })
  import() {
    return { imported: true };
  }
}
```

| Campo | O que faz |
| --- | --- |
| `summary`, `description` | Os textos da rota. |
| `tags` | Como é agrupada, em vez do nome do controller. |
| `responses` | As respostas por código de status. |
| `deprecated` | Marca a rota como obsoleta. |
| `hidden` | Deixa-a fora do documento. A rota continua funcionando. |

Cada resposta é um esquema ou, se não houver corpo a descrever, um texto. Um texto em um código de erro, como o `404` do exemplo, usa o [formato de erro do viga](../../core/exceptions/#o-corpo-de-erro).

No controller, `@Docs` aplica `tags`, `deprecated` e `hidden` a todas as suas rotas, e o que você colocar em um método tem prioridade.

:::caution
`responses` apenas documenta. Não valida nem filtra o que a rota responde, então pode não coincidir com o que seu método devolve, e um campo que não apareça no esquema continua sendo enviado.
:::

## Os esquemas

Os esquemas são convertidos com `~standard.jsonSchema`, uma extensão do Standard Schema, sem depender de uma biblioteca específica:

| Biblioteca | O que fazer |
| --- | --- |
| Zod | Nada. |
| ArkType | Nada. |
| Valibot | Envolva o esquema com `toStandardJsonSchema` de `@valibot/to-json-schema`. |

```ts
import { toStandardJsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';

export const CreateBook = toStandardJsonSchema(v.object({ title: v.string() }));
```

### O que não pode ser convertido

Alguns esquemas não têm equivalente em JSON Schema, como `z.date()`, ou uma biblioteca pode não oferecer a conversão. A aplicação inicia mesmo assim: essa parte fica sem detalhes no documento, e o viga avisa no log uma única vez:

```txt
[OpenApi] POST /books body could not be converted to JSON Schema: Date cannot be represented in JSON Schema
```

Com um `transform`, o resultado não pode ser descrito, então o viga usa o que o esquema aceita como entrada, ou o contrário no corpo de uma requisição. Só avisa se não conseguir nenhum dos dois.

## A partir do código

`OpenApiService` devolve o documento, por exemplo para salvá-lo em um arquivo e gerar um cliente na sua integração contínua:

```ts title="src/export-openapi.ts"
import { writeFile } from 'node:fs/promises';
import { createApp } from 'viga';
import { OpenApiService } from 'viga/openapi';
import { AppModule } from './app.module.ts';

const app = await createApp({ rootModule: AppModule }).init();

await writeFile('openapi.json', JSON.stringify(app.get(OpenApiService).document(), null, 2));
await app.close();
```

`init()` cria todos os providers, então este script precisa das mesmas variáveis de ambiente que a aplicação, e se conecta ao banco de dados se você usar um.

## O que não cobre

- **WebSocket:** os [gateways](../websocket/) não aparecem, porque o OpenAPI descreve APIs HTTP.
- **Middlewares:** as rotas que você adiciona com `app.use()` não aparecem, porque o viga não as conhece.
- **Parâmetros opcionais do Express:** uma rota como `/by/:year{/:month}` é documentada como `/by/{year}/{month}`, porque o OpenAPI não tem parâmetros de rota opcionais.
