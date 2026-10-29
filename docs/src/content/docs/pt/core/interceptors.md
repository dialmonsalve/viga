---
title: Interceptores
description: Como executar código antes e depois de cada método do controller para medir tempos, transformar respostas, fazer cache ou traduzir erros.
sidebar:
  order: 5
---

Um interceptor envolve a execução de um método do controller. Ele pode fazer algo antes, chamar o método e fazer algo depois com o resultado.

Serve para o que se repete em muitas rotas e não é lógica de negócio:

- **Medir tempos**, para encontrar as rotas lentas.
- **Registrar atividade**, por exemplo quem apagou o quê e quando, sem mexer em cada método.
- **Dar o mesmo formato a todas as respostas**, como `{ data: ... }`.
- **Fazer cache** de respostas que quase nunca mudam.
- **Traduzir erros**, como um registro duplicado no banco de dados que deve chegar como 409 e não como 500.
- **Adicionar cabeçalhos**, como `Cache-Control` nas rotas públicas.

Sem interceptores, cada método teria seu próprio `try/catch`, sua medição e seu formato, todos copiados. Com um, você o escreve uma vez e o aplica onde for preciso.

## Seu primeiro interceptor

Um interceptor é uma classe com um método `intercept`, que recebe o contexto da requisição e uma função `next`. `next()` executa o método do controller e devolve uma promise com o resultado:

```ts title="src/common/timing.interceptor.ts"
import { Injectable, type CallHandler, type HttpContext, type Interceptor } from 'viga';

@Injectable()
export class TimingInterceptor implements Interceptor {
  async intercept({ res }: HttpContext, next: CallHandler) {
    const start = performance.now();
    const result = await next();
    res.setHeader('Server-Timing', `app;dur=${(performance.now() - start).toFixed(1)}`);
    return result;
  }
}
```

O que `intercept` devolve é o que o viga envia como resposta. Aqui ele devolve o mesmo resultado sem mudá-lo e só adiciona um cabeçalho.

## Onde se aplicam

Assim como os guards, os interceptores se aplicam a uma rota, a um controller ou a toda a aplicação:

```ts title="src/books/books.controller.ts"
@UseInterceptors(TimingInterceptor)
@Controller('/books')
export class BooksController {
  @UseInterceptors(AuditInterceptor)
  @Delete('/:id')
  remove({ params }: HttpContext) {
    this.books.remove(Number(params.id));
  }
}
```

```ts title="src/main.ts"
const app = createApp({ rootModule: AppModule, globalPrefix: '/api' })
  .enableShutdownHooks()
  .useAuthGuard(AuthGuard)
  .useGlobalInterceptors(TimingInterceptor);
```

Como os guards, um interceptor de classe pode usar `inject()` e não precisa ser declarado em `providers`. Os de `@UseInterceptors()` são criados com o contêiner do módulo do controller, e os globais com o do módulo raiz. Se ele não precisar de providers, pode ser uma função com a mesma assinatura: `(ctx, next) => ...`.

## Transforme a resposta

Como o interceptor decide o que é devolvido, ele pode mudar o resultado. Este envolve todas as respostas em um objeto `data`:

```ts title="src/common/envelope.interceptor.ts"
import { Injectable, type CallHandler, type HttpContext, type Interceptor } from 'viga';

@Injectable()
export class EnvelopeInterceptor implements Interceptor {
  async intercept(_ctx: HttpContext, next: CallHandler) {
    return { data: await next() };
  }
}
```

Com este interceptor, uma rota que devolve `[{ id: 1 }]` responde `{ "data": [{ "id": 1 }] }`.

:::caution
O código de status é calculado com o que o interceptor devolve, não com o que o método devolveu. Se `remove()` não devolve nada, responderia 204; com `EnvelopeInterceptor`, o resultado passa a ser `{ data: undefined }` e a resposta é 200 com o corpo `{}`. Para manter o 204, devolva `undefined` quando o método não devolveu nada.
:::

## Responda sem chamar o método

Se o interceptor não chamar `next()`, o método não é executado e a resposta é o que o interceptor devolver. É a base de um cache:

```ts title="src/common/cache.interceptor.ts"
import { Injectable, inject, type CallHandler, type HttpContext, type Interceptor } from 'viga';
import { CacheService } from './cache.service.ts';

@Injectable()
export class CacheInterceptor implements Interceptor {
  private readonly cache = inject(CacheService);

  async intercept({ req }: HttpContext, next: CallHandler) {
    const cached = this.cache.get(req.originalUrl);
    if (cached !== undefined) return cached;

    const result = await next();
    this.cache.set(req.originalUrl, result);
    return result;
  }
}
```

Isso é seguro em relação às permissões: o viga executa todos os guards antes de qualquer interceptor, então uma resposta em cache nunca chega a alguém que não passou pela autenticação ou pelos guards da rota.

:::caution
Este cache usa só a URL como chave, então serve a mesma resposta para todos os usuários. Use-o só em rotas cuja resposta não depende de quem pede. Em uma rota como `/books/mine`, o segundo usuário receberia os livros do primeiro: inclua o id do usuário na chave, por exemplo `` `${CURRENT_USER.get().id}:${req.originalUrl}` ``, ou não faça cache dela.
:::

`next()` só pode ser chamado uma vez. Se você o chamar duas vezes, a requisição falha com um erro 500 e o log explica o motivo.

## Traduza erros

Se o método lançar um erro, `await next()` o lança dentro do interceptor, então você pode capturá-lo e convertê-lo em uma resposta HTTP:

```ts title="src/common/database-errors.interceptor.ts"
import { ConflictException, Injectable, type CallHandler, type HttpContext, type Interceptor } from 'viga';

@Injectable()
export class DatabaseErrorsInterceptor implements Interceptor {
  async intercept(_ctx: HttpContext, next: CallHandler) {
    try {
      return await next();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException();
      throw error;
    }
  }
}
```

`isUniqueViolation` é uma função sua que reconhece o erro de chave duplicada do seu banco de dados. Assim, um registro duplicado responde 409 em vez de 500, sem um `try/catch` em cada serviço. Relance os erros que você não reconhece para que o viga os trate como sempre.

As exceções do viga, como `NotFoundException`, também passam pelos interceptores. Um interceptor que transforma a resposta, como `EnvelopeInterceptor`, não mexe nelas: como `await next()` lança, o `return { data: ... }` nunca é executado.

## A ordem em que são executados

Para cada requisição, o viga executa primeiro todos os guards e depois os interceptores, de fora para dentro:

1. Os interceptores globais.
2. Os de `@UseInterceptors()` sobre a classe.
3. Os de `@UseInterceptors()` sobre o método.
4. A validação de `@Validate` e o método do controller.

Na volta, eles percorrem o caminho inverso: o interceptor do método recebe o resultado primeiro e o global, por último. Entre vários do mesmo nível, o primeiro da lista é o mais externo.

Se um guard rejeitar a requisição, nenhum interceptor é executado.

:::note
Os interceptores são executados antes de `@Validate`, então `ctx.body`, `ctx.params` e `ctx.query` ainda têm os dados sem validar nem converter. Se um interceptor precisar lê-los, trate-os como dados vindos do cliente. O método do controller recebe os dados validados.
:::

## Guards ou interceptores

As duas ferramentas são executadas ao redor de uma rota, mas respondem a perguntas diferentes:

- **Um guard** decide se a requisição pode continuar. Devolve `true` ou `false` e não vê a resposta.
- **Um interceptor** envolve a execução. Vê o resultado e o erro, e pode mudá-los.

Verificar permissões vai em um guard. Medir, registrar, transformar ou fazer cache vai em um interceptor.
