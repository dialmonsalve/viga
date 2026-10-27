---
title: Módulos
description: Como o viga organiza a aplicação em módulos, o que cada um enxerga, como compartilham providers e quando usar um módulo global.
sidebar:
  order: 1
---

Um módulo reúne os controllers e providers de uma funcionalidade. A aplicação é uma árvore de módulos: o módulo raiz, o que você passa para `createApp`, importa os demais, e cada um pode importar outros.

Na [primeira aplicação](../../start/first-app/) você já escreveu dois: `BooksModule` e `AppModule`. Esta página explica o que acontece entre eles.

## As opções de `@Module`

| Opção | Para que serve |
| --- | --- |
| `imports` | Módulos cujos providers exportados você quer usar. |
| `controllers` | Controllers do módulo. O viga registra suas rotas. |
| `providers` | Classes e valores que o módulo cria e pode injetar. |
| `exports` | Providers do módulo que outros módulos podem usar ao importá-lo. |
| `global` | Deixa seus exports disponíveis em toda a aplicação. Veja mais abaixo. |

Todas são opcionais. Um módulo sem opções, `@Module({})`, é válido, embora não acrescente nada.

## Cada módulo é privado por padrão

Cada módulo tem seu próprio contêiner. Um provider declarado em `providers` só pode ser injetado pelas classes desse mesmo módulo, a menos que você o exporte.

Suponha que você adicione autores à aplicação e queira que `BooksService` use `AuthorsService`:

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

Mesmo com `BooksModule` importando `AuthorsModule`, a aplicação não inicia:

```txt
[DI] BooksModule cannot resolve AuthorsService: it is missing from providers or from the exports of an imported module
```

`AuthorsService` existe, mas é privado de `AuthorsModule`. Importar um módulo só dá acesso ao que ele exporta.

## Exporte o que os outros precisam

Adicione `AuthorsService` a `exports`:

```ts title="src/authors/authors.module.ts" ins={6}
import { Module } from 'viga';
import { AuthorsService } from './authors.service.ts';

@Module({
  providers: [AuthorsService],
  exports: [AuthorsService],
})
export class AuthorsModule {}
```

Agora `BooksService` pode pedi-lo com `inject(AuthorsService)`. O que você não exportar continua sendo um detalhe interno do módulo: você pode mudá-lo sem quebrar ninguém.

Você só exporta providers que o módulo declara ou recebe de seus imports. Os controllers não são exportados: suas rotas são registradas de qualquer forma, não importa quem importe o módulo.

## Uma única instância por provider

O viga carrega cada módulo uma única vez, mesmo que vários o importem. Se `BooksModule` e `ReviewsModule` importam `AuthorsModule`, os dois recebem a mesma instância de `AuthorsService`.

Dentro de um módulo, cada provider é criado na primeira vez que alguém o pede e depois é reutilizado. Por isso um provider pode guardar estado, como a lista de livros em memória da primeira aplicação.

:::caution
Se você declarar a mesma classe em `providers` de dois módulos diferentes, cada módulo cria sua própria instância e o estado não é compartilhado. Para compartilhar um provider, declare-o em um módulo, exporte-o e importe esse módulo onde precisar.
:::

## Reexporte módulos

Um módulo pode exportar um módulo que importa. Assim, quem o importar recebe também os exports desse outro módulo:

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

Importar `SharedModule` equivale a importar `AuthorsModule` e `PublishersModule`. Serve para agrupar módulos que quase sempre são usados juntos.

## Módulos globais

Alguns providers são necessários em quase toda a aplicação, como a configuração. Importar seu módulo em cada lugar seria repetitivo; com `global: true`, seus exports ficam disponíveis em todos os módulos sem importá-lo:

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

Um módulo global é importado uma vez, no módulo raiz:

```ts title="src/app.module.ts"
import { Module } from 'viga';
import { BooksModule } from './books/books.module.ts';
import { ClockModule } from './clock/clock.module.ts';

@Module({ imports: [ClockModule, BooksModule] })
export class AppModule {}
```

Se você o importar a partir de outro módulo, o viga não inicia e diz para onde movê-lo:

```txt
[Module] ClockModule is global and is imported from BooksModule, but not from the root module; move it to the imports of AppModule
```

Essa regra faz com que todos os módulos globais fiquem visíveis em um único arquivo. `ConfigModule.forRoot()`, de `viga/config`, é um módulo global e é importado assim.

:::tip
Use módulos globais só para o que é realmente transversal. Um import explícito deixa claro do que cada módulo depende; um global esconde isso.
:::

## Onde o viga procura um provider

Quando uma classe pede um provider com `inject()`, o viga o procura nesta ordem e usa o primeiro que encontrar:

1. Os `providers` do próprio módulo.
2. Os `exports` dos módulos que ele importa, incluindo o que estes reexportam.
3. Os `exports` dos módulos globais.

Se não aparecer em nenhum deles, a aplicação não inicia e o erro nomeia o módulo e o provider que falta.

## Erros ao carregar os módulos

O viga verifica a árvore de módulos ao iniciar e falha antes de abrir a porta:

- **Importação circular.** Se `BooksModule` importa `AuthorsModule` e `AuthorsModule` importa `BooksModule`, o erro mostra a cadeia a partir do módulo raiz: `[Module] Circular import: AppModule -> BooksModule -> AuthorsModule -> BooksModule`. Costuma indicar que há um provider que deveria viver em um terceiro módulo que os dois importem.
- **Classe sem `@Module()`.** Se você colocar em `imports` uma classe que não é um módulo: `[Module] AuthorsService must be decorated with @Module()`.
