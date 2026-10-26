---
title: O que é o viga
description: Framework HTTP para Node.js com módulos, injeção de dependências e decoradores padrão.
sidebar:
  order: 1
---

O viga é um framework HTTP para Node.js construído sobre o Express 5. Ele organiza uma API em módulos, resolve suas dependências com injeção de dependências e usa os decoradores padrão do JavaScript para declarar controllers, rotas, guards e interceptors.

## O problema que ele resolve

O Express é pequeno e flexível, mas deixa quase tudo nas suas mãos. Em cada projeto novo é preciso decidir como organizar o código, como compartilhar serviços entre as partes da aplicação, como validar o que chega, como responder aos erros e quais cabeçalhos e limites configurar. Cada equipe resolve isso do seu jeito, e essas decisões se repetem de projeto em projeto.

O viga parte de uma estrutura já decidida. Você define módulos, controllers e serviços, e o framework os conecta. Além disso, a aplicação começa fechada: toda rota é privada até você marcá-la como pública com `@Public()`, e se você não configurar como autenticar, as rotas privadas respondem 401 em vez de ficarem abertas por esquecimento.

## Para quem é

O viga é para quem constrói APIs HTTP com Node.js e TypeScript e quer:

- Uma estrutura clara desde o primeiro dia, sem precisar inventá-la.
- Partir de uma aplicação fechada e abrir só o que decidir, em vez de fechar depois o que ficou exposto.
- Liberdade para escolher suas ferramentas: a biblioteca de validação, o ORM ou a forma de autenticar.
- Continuar usando o ecossistema do Express, com seus middlewares de sempre.

Se você vem do NestJS, a forma de organizar o código vai parecer familiar.

## Ideias principais

### Decoradores padrão do JavaScript

O viga usa os decoradores padrão do JavaScript, a proposta do comitê TC39 que o TypeScript suporta sem opções experimentais. Ele não precisa de `reflect-metadata`, `experimentalDecorators` nem `emitDecoratorMetadata`. As dependências são pedidas de forma explícita com `inject()`:

```ts
@Injectable()
class BooksService {
  private readonly database = inject(DatabaseService);
}
```

### Um núcleo pequeno e módulos opcionais

O núcleo traz só o que toda API precisa: módulos, injeção de dependências, controllers, guards, interceptors, exceções HTTP e ciclo de vida. O resto fica em subcaminhos opcionais, como `viga/validation`, `viga/config`, `viga/i18n`, `viga/pagination`, `viga/drizzle`, `viga/websocket` e `viga/testing`. Se você não os importa, nada extra é instalado.

### Fechado por padrão

Além das rotas privadas, o viga vem com padrões ativados que reduzem riscos comuns:

- Cabeçalhos de segurança, limite de tamanho do body e tempos máximos para receber cada requisição.
- Uma rota sem esquema de body não aceita body, então dados não validados não chegam ao seu código.
- Formulários enviados de outros sites são rejeitados, que é o caminho habitual de um ataque CSRF.
- Quando há um guard de autenticação, rotas inexistentes respondem igual às privadas para quem não tem sessão, para que não seja possível descobrir quais rotas existem.

Cada um pode ser ajustado ou desativado de forma explícita. Esses padrões não tornam uma aplicação segura por si só: a segurança também depende do seu código, da sua configuração e da sua infraestrutura.

### Escolha suas ferramentas

O viga não prende você a uma biblioteca específica. A validação funciona com qualquer biblioteca compatível com o [Standard Schema](https://standardschema.dev), como Zod, Valibot ou ArkType. O banco de dados pode usar o módulo do Drizzle ou qualquer outro ORM por meio de um provider. E para autenticar, você configura seu próprio guard com a biblioteca que preferir.

### Promises, sem RxJS

Handlers, guards e interceptors trabalham com promises e `async/await`. Não há observables para aprender.

## Inspirado no NestJS

O viga é inspirado no [NestJS](https://nestjs.com). Os módulos, a injeção de dependências, os controllers com decoradores, os guards e os interceptors vêm das ideias que Kamil Myśliwiec e a comunidade do Nest vêm aperfeiçoando há anos.

O viga não compartilha código com o Nest. Ele leva essas ideias para outro terreno: decoradores padrão em vez de `experimentalDecorators` e `reflect-metadata`, promises em vez de RxJS e um núcleo pequeno com todo o resto opcional.

Do [Express](https://expressjs.com) ele toma a base: o viga roda sobre o Express 5, então seus middlewares, como o `cors`, funcionam com `app.use()`, e cada handler tem à mão a requisição e a resposta do Express quando precisa delas.

## O que o viga não faz

O viga se limita ao que quase toda API HTTP precisa. O que pode ser bem resolvido por fora não faz parte do framework, para que ele continue pequeno e fácil de entender. Por isso, ele não inclui:

- Um sistema de autenticação próprio, como JWT, OAuth ou sessões. O viga oferece o lugar para conectá-lo, `app.useAuthGuard()`, e você escolhe a biblioteca.
- Cache, filas ou tarefas agendadas.
- Envio de e-mail ou armazenamento de arquivos.
- GraphQL ou microsserviços.

Para várias dessas necessidades, a documentação vai incluir guias que mostram como integrá-las com bibliotecas conhecidas.
