---
title: Repositórios
description: Separe o acesso a dados do serviço com um repositório e um token, e substitua-o nos testes.
sidebar:
  order: 4
---

Na primeira aplicação, o serviço guarda a lista de livros. Funciona, mas quando a aplicação cresce convém separar a lógica, que fica no serviço, do acesso aos dados, que passa para um repositório. Assim você pode mudar de onde vêm os dados, por exemplo da memória para um banco de dados, sem mexer no serviço, e substituir o repositório nos testes.

Este guia parte do projeto da [primeira aplicação](../first-app/).

## Defina o repositório

Primeiro você define o que o repositório oferece, com uma interface:

```ts title="src/books/books.repository.ts"
import { InjectionToken } from 'viga';

export interface Book {
  id: number;
  title: string;
}

export interface BooksRepository {
  findAll(): Promise<Book[]>;
}

export const BOOKS_REPOSITORY = new InjectionToken<BooksRepository>('BOOKS_REPOSITORY');
```

O TypeScript apaga as interfaces ao compilar, então elas não podem ser usadas para pedir uma dependência. `BOOKS_REPOSITORY` é o token que a representa: quem o pedir vai receber algo que cumpre `BooksRepository`. É o mesmo que no NestJS se faz com `@Inject()` e um token.

## Escreva uma implementação

Esta implementação guarda os livros na memória. A interface `Book` agora fica no repositório:

```ts title="src/books/in-memory-books.repository.ts"
import { Injectable } from 'viga';
import type { Book, BooksRepository } from './books.repository.ts';

@Injectable()
export class InMemoryBooksRepository implements BooksRepository {
  private readonly books: Book[] = [
    { id: 1, title: 'Dune' },
    { id: 2, title: 'Fundação' },
  ];

  async findAll() {
    return this.books;
  }
}
```

## Peça o repositório no serviço

O serviço pede o repositório pelo token e não sabe qual implementação está por trás:

```ts title="src/books/books.service.ts"
import { Injectable, inject } from 'viga';
import { BOOKS_REPOSITORY } from './books.repository.ts';

@Injectable()
export class BooksService {
  private readonly books = inject(BOOKS_REPOSITORY);

  findAll() {
    return this.books.findAll();
  }
}
```

`inject(BOOKS_REPOSITORY)` devolve um valor com o tipo `BooksRepository`. Se você chamar um método que a interface não tem, o TypeScript marca como erro.

## Escolha a implementação no módulo

O módulo decide qual implementação corresponde ao token:

```ts title="src/books/books.module.ts"
import { Module } from 'viga';
import { BOOKS_REPOSITORY } from './books.repository.ts';
import { BooksController } from './books.controller.ts';
import { BooksService } from './books.service.ts';
import { InMemoryBooksRepository } from './in-memory-books.repository.ts';

@Module({
  controllers: [BooksController],
  providers: [BooksService, { provide: BOOKS_REPOSITORY, useClass: InMemoryBooksRepository }],
})
export class BooksModule {}
```

Para passar a um banco de dados, você escreve outra implementação e só muda o `useClass`. Nem o serviço nem o controller mudam.

## Substitua-o nos testes

`createTestingApp`, de `viga/testing`, inicia a aplicação substituindo o repositório sem mexer no seu código:

```ts title="src/books/books.test.ts"
import { createTestingApp } from 'viga/testing';
import { AppModule } from '../app.module.ts';
import { BOOKS_REPOSITORY } from './books.repository.ts';

const app = await createTestingApp(AppModule, {
  overrides: [
    { provide: BOOKS_REPOSITORY, useValue: { findAll: async () => [{ id: 9, title: 'Livro de teste' }] } },
  ],
});

const { body } = await app.request('/books');
await app.close();
```

`body` contém o livro de teste: o serviço e o controller são os reais, e só o repositório mudou. Você pode executar este arquivo com o `tsx` ou dentro da sua ferramenta de testes, como o `node:test`, que você verá em [viga/testing](../../optional/testing/).
