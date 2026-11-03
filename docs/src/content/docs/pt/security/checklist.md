---
title: Lista para testes de segurança
description: O que depende do seu código e vale revisar antes de uma auditoria ou de um teste de invasão, com exemplos de como resolver no viga.
sidebar:
  order: 4
---

O viga cobre algumas camadas comuns com seus [valores padrão](../defaults/), mas muitas outras dependem do seu código. Esta lista reúne o que um teste de segurança de caixa cinza verifica primeiro, ou seja, com usuários e papéis reais da sua aplicação.

Não é uma lista completa: é um ponto de partida. Revise-a antes de cada lançamento em produção e antes de uma auditoria.

## Autorização por recurso

Exigir uma sessão não basta: é preciso verificar que o recurso pertence a quem o pede. Se `GET /orders/42` devolve o pedido 42 a qualquer usuário autenticado, um usuário pode ver os pedidos de outros mudando o número. Essa falha se chama IDOR (*insecure direct object reference*) e é uma das mais frequentes.

Filtre pelo usuário atual no repositório, não depois:

```ts title="src/orders/orders.repository.ts"
findOwned(id: number) {
  const { id: ownerId } = CURRENT_USER.get();
  return this.database.db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.ownerId, ownerId)),
  });
}
```

Se não encontrar, responda 404 e não 403. Com um 403 você confirmaria que o pedido 42 existe e é de outra pessoa.

## Várias empresas na mesma aplicação

Em uma aplicação multi-tenant, a mesma falha aparece entre empresas: um usuário da empresa A não deve ver dados da empresa B. O identificador da empresa que o cliente envia, por exemplo em um cabeçalho, nunca é confiável por si só. Verifique-o em um guard contra os tenants do usuário autenticado, guarde-o em uma [chave de contexto](../../core/request-lifecycle/#o-contexto-da-requisição) e filtre todas as consultas por ele.

## Atribuição em massa

Se você salva o corpo da requisição como está, um cliente pode adicionar campos que você não esperava, como `"role": "admin"` ou `"ownerId": 7`. Valide todo corpo com [`@Validate`](../../optional/validation/#os-campos-que-sobram-são-descartados) e use o valor validado: os campos que não estão no schema são descartados. Se preferir rejeitá-los, use um objeto estrito da sua biblioteca de schemas, como `z.strictObject()` no Zod ou `v.strictObject()` no Valibot.

`requireValidation` já rejeita o corpo nas rotas que não o validam, mas não pode saber se o seu schema inclui um campo que não deveria.

## Papéis e permissões

Coloque o guard de papéis sobre o controller com [`@UseGuards()`](../../core/guards/#guards-por-rota), não em cada método. Assim uma rota nova não fica aberta por esquecimento. Revise também a lista de rotas públicas que o viga mostra ao iniciar com nível `debug`: é tudo o que qualquer pessoa pode chamar sem se autenticar.

## Força bruta

Limite o login, o cadastro, a recuperação de senha e a verificação de códigos com [`@RateLimit()`](../rate-limiting/#por-rota). Para o login, uma chave por IP e email freia quem testa muitas senhas para uma mesma conta.

Garanta que [`trustProxy`](../client-ip/) coincida com os proxies que você tem na frente. Senão, o limite se aplica ao IP do proxy, ou um atacante pode mudar de IP a cada requisição.

## Mensagens de erro

Não diferencie "o usuário não existe" de "a senha está incorreta": responda sempre com `UnauthorizedException()`. Se você diferenciar, um atacante pode descobrir quais emails estão cadastrados. O mesmo vale para a recuperação de senha: responda igual exista ou não a conta.

Os erros inesperados já respondem com uma mensagem genérica, mas verifique se as suas próprias exceções não incluem detalhes internos, como nomes de tabelas ou a mensagem original do banco de dados.

## CORS

Configure o CORS com uma lista explícita de origens. Nunca combine `origin: '*'` com `credentials: true`: permitiria que qualquer site fizesse requisições com os cookies dos seus usuários.

## CSRF

Se você autentica com cookies, mantenha a [proteção CSRF](../defaults/#proteção-csrf) ativada e nunca altere dados em uma rota `GET`: ela não é verificada, porque um link ou uma imagem podem provocá-la.

## WebSocket

Se você usa [`viga/websocket`](../../optional/websocket/), verifique três coisas:

- **`allowedOrigins`** contém só os seus sites, para que outra página não consiga abrir um WebSocket com os cookies dos seus usuários.
- **As sessões expiram**: devolva `expiresAt` em `authenticate` para que uma conexão aberta não continue funcionando com uma sessão que já expirou.
- **Cada evento que recebe dados tem um schema** em `@OnMessage`.

## Segredos e configuração

- Valide as variáveis de ambiente com [`viga/config`](../../optional/config/), para que uma configuração incompleta impeça a aplicação de iniciar em vez de falhar mais tarde.
- Não envie o arquivo `.env` para o repositório.
- Em produção, conecte-se ao banco de dados com TLS verificado. [`viga/drizzle`](../../optional/drizzle/#tls) avisa ao iniciar se não for assim.

## Dependências

Verifique as vulnerabilidades conhecidas das suas dependências com regularidade, por exemplo com o comando `audit` do seu gerenciador de pacotes (`pnpm audit`, `npm audit`...) ou com a ferramenta do seu provedor de repositórios, e mantenha-as atualizadas.
