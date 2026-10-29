---
title: Providers e injeção de dependências
description: O que é um provider, como pedi-lo com inject(), as quatro formas de declará-lo e os erros que o viga detecta ao iniciar.
sidebar:
  order: 2
---

Um provider é algo que o contêiner do viga cria e entrega a quem pedir: um serviço, um repositório, um valor de configuração. Em vez de cada classe criar o que precisa com `new`, ela o pede com `inject()` e o contêiner decide o que entregar.

Isso traz duas vantagens. Cada provider é criado uma única vez e compartilhado, e você pode substituir um por outro sem mexer em quem o usa, como viu em [repositórios](../../start/repositories/).

## Declare e peça um provider

Uma classe vira provider com `@Injectable()` e sendo declarada em `providers` de um módulo:

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

Outra classe do módulo o pede com `inject()` em um campo:

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

`inject(Clock)` devolve uma instância com o tipo `Clock`, sem anotações extras. Os controllers pedem providers da mesma forma, embora sejam declarados em `controllers`, não em `providers`.

## Por que `inject()` e não o construtor

Os decorators padrão do JavaScript, que são os que o viga usa, não expõem os tipos dos parâmetros do construtor. Por isso o viga não consegue saber o que um construtor pede, e as dependências são pedidas de forma explícita com `inject()`. Em troca, você não precisa de `reflect-metadata` nem de `emitDecoratorMetadata`.

Se você vem do NestJS: lá as dependências chegam pelo construtor porque o TypeScript emite seus tipos com `emitDecoratorMetadata` e o NestJS os lê com `reflect-metadata`.

`inject()` só funciona enquanto o contêiner constrói a classe: na inicialização de um campo, como acima, ou dentro do construtor. Se você o chamar depois, por exemplo dentro de um método, ele falha:

```txt
[DI] inject(Clock) can only be called while the container is constructing a class
```

A solução é pedir a dependência em um campo e usá-la a partir do método.

## As quatro formas de declarar um provider

| Forma | Quem cria o objeto | Quando usar |
| --- | --- | --- |
| `Clock` | O contêiner, com `new Clock()` | A forma curta de `{ provide: Clock, useClass: Clock }`. É a habitual para seus serviços. |
| `{ provide: TOKEN, useClass: Classe }` | O contêiner, com `new Classe()` | O token é diferente da classe, por exemplo uma interface com várias implementações. |
| `{ provide: TOKEN, useValue: valor }` | Ninguém: já existe | O valor já está pronto, como um objeto de opções ou uma instância criada em outro lugar. |
| `{ provide: TOKEN, useFactory: () => valor }` | Sua função, uma vez ao iniciar | O construtor precisa de argumentos, a classe não é sua ou o valor depende de lógica. |

`provide` pode ser uma classe ou um `InjectionToken`. As classes que você entregar com a forma curta ou com `useClass` precisam de `@Injectable()`; se faltar, o viga não inicia:

```txt
[DI] Clock must be decorated with @Injectable()
```

### `useClass`: escolher uma implementação

Associa um token a uma classe: quando alguém pedir o token, o contêiner cria essa classe. A forma curta que você usou até agora é um caso de `useClass` em que o token e a classe são a mesma:

```ts
providers: [Clock]
providers: [{ provide: Clock, useClass: Clock }]
```

As duas linhas fazem o mesmo. A forma longa faz sentido quando o token é diferente da classe, normalmente um `InjectionToken` que representa uma interface. Foi o que você fez em [repositórios](../../start/repositories/):

```ts
providers: [{ provide: BOOKS_REPOSITORY, useClass: InMemoryBooksRepository }]
```

Quem pede `inject(BOOKS_REPOSITORY)` recebe um `InMemoryBooksRepository`. Para passar a um banco de dados, você muda só a classe.

### `useValue`: entregar um valor pronto

Serve para valores que não precisam ser construídos, como um objeto de opções:

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

`inject(BOOKS_OPTIONS)` devolve o objeto com o tipo `BooksOptions`.

### `useFactory`: construir o valor com código

Serve para criar objetos de classes que não são suas e não têm `@Injectable()`, como o cliente de uma biblioteca. A função é executada uma única vez e pode usar `inject()` para pedir outros providers:

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

`SEARCH_CLIENT` é um `InjectionToken<SearchClient>` declarado em `search.client.ts`, e `some-search-library` representa a biblioteca que você usar.

A função deve devolver o valor diretamente, não uma promise. Se você precisar de trabalho assíncrono ao iniciar, como conectar-se a um banco de dados, faça-o no hook `onModuleInit` do provider, que você verá no [ciclo de vida da aplicação](../app-lifecycle/#os-hooks-dos-providers).

## Quando são criados

O viga cria todos os providers ao iniciar, antes de abrir a porta, e cada um uma única vez por módulo. Se um provider falhar ao ser construído ou faltar uma dependência, você descobre ao iniciar a aplicação, não na primeira requisição.

Se um provider pede outro que ainda não existe, o viga o cria nesse momento e o entrega.

## Providers que o viga já traz

Alguns providers estão disponíveis em todos os módulos sem declará-los. O mais útil é `LOGGER`, o logger da aplicação:

```ts title="src/books/books.service.ts"
import { Injectable, LOGGER, inject } from 'viga';

@Injectable()
export class BooksService {
  private readonly logger = inject(LOGGER);

  findAll() {
    this.logger.info('Listando livros');
    return [];
  }
}
```

Ele tem os métodos `info`, `warn`, `error` e `debug`.

## Dependências circulares

Se `BooksService` pede `ReviewsService` e `ReviewsService` pede `BooksService`, nenhum dos dois pode ser criado primeiro. O viga detecta isso ao iniciar e mostra a cadeia:

```txt
[DI] Circular dependency in BooksModule: BooksService -> ReviewsService -> BooksService
```

O viga não oferece uma forma de contornar esse erro. Quase sempre significa que os dois serviços compartilham uma responsabilidade que deveria viver em um terceiro provider do qual ambos dependam.

Não é o mesmo que uma [importação circular](../modules/#erros-ao-carregar-os-módulos), que acontece entre módulos e não entre providers.
