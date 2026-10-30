---
title: Primeira aplicação
description: Crie uma API com um módulo, um controller e um serviço, e inicie-a passo a passo.
sidebar:
  order: 3
---

Neste guia você constrói uma API pequena que lista livros. Ela serve para ver as três peças com que se monta qualquer aplicação do viga: serviços, controllers e módulos. Antes, siga os passos da instalação.

## Estrutura do projeto

Ao terminar, o projeto terá estes arquivos:

```txt
src/
  books/
    books.service.ts
    books.controller.ts
    books.module.ts
  app.module.ts
  main.ts
```

Cada funcionalidade fica na sua própria pasta, com o seu módulo. `app.module.ts` reúne todas e `main.ts` inicia a aplicação.

## O serviço

Um serviço contém a lógica da aplicação. Aqui ele devolve uma lista fixa de livros. Numa aplicação real, consultaria o banco de dados.

```ts title="src/books/books.service.ts"
import { Injectable } from 'viga';

export interface Book {
  id: number;
  title: string;
}

@Injectable()
export class BooksService {
  private readonly books: Book[] = [
    { id: 1, title: 'Dune' },
    { id: 2, title: 'Fundação' },
  ];

  findAll() {
    return this.books;
  }
}
```

`@Injectable()` permite que o viga crie o serviço e o entregue a quem pedir.

## O controller

Um controller recebe as requisições HTTP e responde. Ele não contém lógica: pede ao serviço.

```ts title="src/books/books.controller.ts"
import { Controller, Get, Public, inject } from 'viga';
import { BooksService } from './books.service.ts';

@Controller('/books')
export class BooksController {
  private readonly books = inject(BooksService);

  @Public()
  @Get()
  list() {
    return this.books.findAll();
  }
}
```

- `@Controller('/books')` define o prefixo de todas as rotas do controller.
- `@Get()` responde a `GET /books`. O que o método devolve é enviado como JSON e, se for uma promise, o viga espera ela ser resolvida.
- `inject(BooksService)` pede o serviço. O viga o cria uma vez e o compartilha.
- `@Public()` abre a rota. Sem ele, ela seria privada.

## O módulo

Um módulo agrupa os controllers e serviços de uma funcionalidade.

```ts title="src/books/books.module.ts"
import { Module } from 'viga';
import { BooksController } from './books.controller.ts';
import { BooksService } from './books.service.ts';

@Module({
  controllers: [BooksController],
  providers: [BooksService],
})
export class BooksModule {}
```

Os serviços vão em `providers`. Só os controllers e serviços deste módulo podem pedi-los, a menos que o módulo os exporte.

## O módulo raiz

O módulo raiz reúne os módulos da aplicação:

```ts title="src/app.module.ts"
import { Module } from 'viga';
import { BooksModule } from './books/books.module.ts';

@Module({ imports: [BooksModule] })
export class AppModule {}
```

## Inicie a aplicação

```ts title="src/main.ts"
import { createApp } from 'viga';
import { AppModule } from './app.module.ts';

const app = createApp({ rootModule: AppModule, globalPrefix: '/api' }).enableShutdownHooks();

await app.listen();
```

- `globalPrefix` coloca `/api` na frente de todas as rotas.
- `enableShutdownHooks()` encerra a aplicação de forma ordenada quando o processo para, por exemplo com `Ctrl+C`.
- `listen()` começa a escutar na porta 3000. A porta é opcional: `listen(8080)` usa outra. O viga não lê a variável de ambiente `PORT` por conta própria; se você a usa, passe-a você mesmo: `app.listen(Number(process.env.PORT ?? 3000))`, ou valide-a junto com o resto da configuração com [`viga/config`](../../optional/config/#em-maints).

Inicie em modo de desenvolvimento:

```sh
pnpm dev
```

## Teste a API

```sh
curl http://localhost:3000/api/books
```

```json
[{ "id": 1, "title": "Dune" }, { "id": 2, "title": "Fundação" }]
```

## As rotas são privadas por padrão

Remova `@Public()` do controller e teste de novo. A rota responde 401:

```json
{
  "statusCode": 401,
  "code": "errors.unauthorized",
  "message": "You must sign in to continue",
  "error": "Unauthorized"
}
```

Além disso, ao iniciar, a aplicação avisa quantas rotas privadas não têm como autenticar:

```txt
[App] No auth guard is configured, so the 1 private routes will respond 401; add app.useAuthGuard() or mark public routes with @Public()
```

No viga, uma rota é aberta de propósito, nunca por esquecimento. Para as rotas que exigem sessão, você configura a sua própria autenticação com `app.useAuthGuard()`, como verá na seção do núcleo.

## Próximos passos

Agora você tem uma aplicação com um módulo, um controller e um serviço. O próximo passo é separar o acesso a dados num [repositório](../repositories/), para mudar de onde vêm os dados sem mexer no serviço e substituí-los nos testes. Depois, você pode validar os dados que chegam, organizar mais módulos e conectar um banco de dados, que é o que as próximas seções cobrem.

<img src="/mascot-beam.svg" alt="" width="260" style="display: block; margin: 2rem auto 0" />
