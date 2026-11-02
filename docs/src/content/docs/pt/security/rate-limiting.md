---
title: Limite de requisições
description: Limite quantas requisições um cliente pode fazer em um período, para toda a aplicação ou por rota, e como escolher a chave e o armazenamento do contador.
sidebar:
  order: 2
---

Um limite de requisições conta quantas requisições cada cliente faz em uma janela de tempo e, se passar do máximo, responde 429 até a janela terminar. Serve para frear ataques de força bruta contra o login, o abuso de rotas custosas ou os scripts que chamam sua API sem parar.

No HTTP ele vem **desativado**: você decide onde colocá-lo. Ele não é ativado sozinho porque, atrás de um proxy mal configurado, todos os usuários compartilhariam o IP do proxy e seriam bloqueados ao mesmo tempo. Leia [IP do cliente e proxies](../client-ip/) antes de ativá-lo. No WebSocket há um limite por conexão ativado por padrão, como explicado em [`@vigajs/core/websocket`](../../optional/websocket/#limites-por-padrão).

## Para toda a aplicação

`rateLimit()` é um middleware que limita todas as requisições de cada cliente:

```ts title="src/main.ts"
import { createApp, rateLimit } from '@vigajs/core';

const app = createApp({ rootModule: AppModule }).enableShutdownHooks();
app.use(rateLimit({ max: 300, windowMs: 60_000 }));
```

Aqui cada IP pode fazer 300 requisições por minuto, somando todas as rotas.

## Por rota

`@RateLimit()` dá a uma rota seu próprio limite, ou a todas as de um controller se você o colocar sobre a classe. É o adequado para as rotas sensíveis, como o login:

```ts title="src/auth/auth.controller.ts"
import { Controller, Post, Public, RateLimit, type HttpContext } from '@vigajs/core';
import { Validate } from '@vigajs/core/validation';
import { z } from 'zod';

const Login = z.object({ email: z.email(), password: z.string() });

@Public()
@Controller('/auth')
export class AuthController {
  @Post('/login')
  @RateLimit({ max: 5, windowMs: 15 * 60_000 })
  @Validate({ body: Login })
  login({ body }: HttpContext<{ body: typeof Login }>) {
    return this.auth.login(body);
  }
}
```

Cada limite tem seu próprio contador. Se a aplicação tem um limite global e uma rota tem o seu, uma requisição a essa rota conta nos dois.

`@RateLimit()` é um guard, então é executado com os demais [guards da rota](../../core/guards/#a-ordem-em-que-são-executados), antes da validação e do método.

## A resposta

Cada resposta leva três cabeçalhos com o estado do contador:

| Cabeçalho | O que indica |
| --- | --- |
| `RateLimit-Limit` | O máximo de requisições da janela. |
| `RateLimit-Remaining` | Quantas restam. |
| `RateLimit-Reset` | Quantos segundos faltam para a janela reiniciar. |

Quando o cliente passa do máximo, a resposta é um 429 com o código `errors.tooManyRequests` e o cabeçalho `Retry-After`, que diz quantos segundos esperar.

## A chave do contador

O contador é mantido por chave: duas requisições com a mesma chave somam no mesmo contador. Por padrão, a chave é o IP do cliente, normalizado com `ipKey()`:

- Um endereço IPv4 escrito como IPv6, como `::ffff:1.2.3.4`, conta como seu IPv4, `1.2.3.4`.
- Um endereço IPv6 conta como sua rede `/56`. Quem controla um endereço IPv6 costuma controlar o bloco inteiro, e sem isso poderia conseguir um contador novo com cada endereço.

### Uma chave própria

A opção `key` recebe a requisição e devolve a chave. Para o login, limitar por IP e por email ao mesmo tempo freia quem testa muitas senhas para uma mesma conta, sem bloquear outros usuários da mesma rede:

```ts
import { RateLimit, ipKey } from '@vigajs/core';

@RateLimit({
  max: 5,
  windowMs: 15 * 60_000,
  key: (req) => `${ipKey(req.ip ?? '')}:${req.body?.email}`,
})
```

Use `ipKey()` sempre que montar uma chave a partir do IP, para que os endereços IPv6 sejam agrupados igual à chave padrão. `ipKey(address, 64)` agrupa por outro tamanho de rede.

A chave pode usar o corpo porque `@RateLimit()` é executado depois de lê-lo. Mas ele ainda não está validado: trate-o como dados vindos do cliente. As chaves com mais de 128 caracteres são guardadas como um hash, então um valor enorme não ocupa mais memória.

## Onde o contador é guardado

Por padrão, o contador vive na memória do processo, em um `MemoryRateLimitStore`. Para que ele não possa esgotar a memória:

- Guarda no máximo 10.000 chaves. Você pode mudar isso com `new MemoryRateLimitStore({ maxKeys })`, passado na opção `store`.
- Quando está cheio, descarta primeiro a chave mais antiga vista uma única vez. Assim, uma avalanche de chaves novas, por exemplo com emails inventados, não consegue apagar o contador de uma chave que está sendo atacada.
- Se todas as chaves guardadas estão ativas e repetidas, trata uma chave nova como se já tivesse superado o limite até que alguma expire: na dúvida, rejeita em vez de deixar passar. Se o tráfego legítimo puder enchê-lo, aumente `maxKeys`.

### Várias instâncias

O contador em memória é de cada processo. Se sua aplicação roda em várias instâncias, cada uma conta por conta própria e o limite real se multiplica pelo número de instâncias. Para compartilhar o contador, implemente a interface `RateLimitStore` sobre Redis ou outro armazenamento compartilhado e passe-a em `store`:

```ts
import type { RateLimitHit, RateLimitStore } from '@vigajs/core';

export class SharedRateLimitStore implements RateLimitStore {
  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    ...
  }
}
```

`hit` soma uma requisição à chave e devolve quantas ela tem (`count`) e quando a janela reinicia (`resetAt`, em milissegundos desde 1970). Com Redis, o habitual é um `INCR` da chave e, se for a primeira requisição, um `PEXPIRE` com a duração da janela, os dois em uma mesma transação.

## Janela fixa

A janela é fixa: começa com a primeira requisição e dura `windowMs`. Um cliente pode fazer `max` requisições no fim de uma janela e outras `max` no início da seguinte, então em pouco tempo pode chegar ao dobro. Escolha `max` levando em conta essa rajada.

## No WebSocket

Para limitar eventos de um gateway, use o `RateLimit` importado de `@vigajs/core/websocket`, não o de `@vigajs/core`. Isso é explicado em [`@vigajs/core/websocket`](../../optional/websocket/#guards-interceptores-e-limites-por-evento).
