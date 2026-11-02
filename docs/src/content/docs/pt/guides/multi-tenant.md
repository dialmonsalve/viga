---
title: Multi-tenant com subdomínios
description: Uma única aplicação para várias empresas, cada uma em seu subdomínio, com os dados separados e sem que um usuário possa entrar em outra empresa.
sidebar:
  order: 4
---

Em uma aplicação multi-tenant, várias empresas (*tenants*) usam a mesma aplicação e o mesmo banco de dados, cada uma com seus dados. Uma forma comum de separá-las é o subdomínio: `acme.meuapp.com` é a empresa Acme e `globex.meuapp.com` é a Globex.

O viga não traz nada específico para isso, porque se resolve com peças que ele já tem: um middleware que identifica a empresa, uma [chave de contexto](../../core/request-lifecycle/#o-contexto-da-requisição) que a guarda e um guard que verifica se o usuário pertence a ela.

:::caution
O erro mais grave em uma aplicação multi-tenant é um usuário ver dados de outra empresa. Tudo o que o cliente envia, inclusive o subdomínio, pode ser falsificado. Identificar a empresa não basta: é preciso verificar sempre se o usuário pertence a ela, e filtrar todas as consultas.
:::

## Identifique a empresa

Uma chave de contexto guarda a empresa da requisição atual:

```ts title="src/tenants/current-tenant.ts"
import { createContextKey } from '@vigajs/core';

export interface Tenant {
  id: number;
  slug: string;
}

export const CURRENT_TENANT = createContextKey<Tenant>('currentTenant');
```

Um middleware lê o subdomínio, procura a empresa e a guarda. Se ela não existir, responde 404:

```ts title="src/tenants/tenant.middleware.ts"
import type { RequestHandler } from 'express';
import { NotFoundException } from '@vigajs/core';
import { CURRENT_TENANT } from './current-tenant.ts';
import type { TenantsService } from './tenants.service.ts';

const BASE_DOMAIN = 'meuapp.com';

function slugFrom(hostname: string) {
  const suffix = `.${BASE_DOMAIN}`;
  if (!hostname.endsWith(suffix)) return undefined;

  const slug = hostname.slice(0, -suffix.length);
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) ? slug : undefined;
}

export function tenantMiddleware(tenants: () => TenantsService): RequestHandler {
  return async (req, _res, next) => {
    const slug = slugFrom(req.hostname);
    const tenant = slug && (await tenants().findBySlug(slug));
    if (!tenant) throw new NotFoundException();

    CURRENT_TENANT.set(tenant);
    next();
  };
}
```

`slugFrom` só aceita um subdomínio válido logo antes do seu domínio: rejeita o domínio raiz (`meuapp.com`), os domínios alheios (`evil.com`), os subdomínios aninhados (`a.acme.meuapp.com`) e os que começam ou terminam com hífen.

É um middleware e não um guard porque precisa ser executado **antes do guard de autenticação**, e também nas rotas públicas, como o login.

Registre-o em `main.ts`. Os middlewares são adicionados antes de iniciar, mas `app.get()` só funciona depois, então ele recebe uma função que obtém o serviço quando cada requisição chega:

```ts title="src/main.ts"
const app = createApp({ rootModule: AppModule, trustProxy: 1 })
  .enableShutdownHooks()
  .useAuthGuard(AuthGuard);

app.use(tenantMiddleware(() => app.get(TenantsService)));

await app.listen();
```

`TenantsService` precisa estar visível a partir do módulo raiz, como qualquer provider que você peça com `app.get()`.

Esse middleware é executado em todas as requisições, então guarde as empresas em memória por alguns segundos em vez de consultar o banco de dados a cada vez.

## Verifique se o usuário pertence à empresa

Este é o passo-chave. O subdomínio é escolhido por quem faz a requisição: sem essa verificação, um usuário da Acme poderia entrar em `globex.meuapp.com` com sua sessão e ver os dados da Globex.

Se você usa [JWT](../jwt-auth/), inclua a empresa no token ao fazer login:

```ts
new SignJWT({ tenantId: tenant.id })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(user.id)
  .setExpirationTime('15m')
  .sign(key);
```

E compare-a no guard de autenticação:

```ts title="src/auth/auth.guard.ts" ins={8}
async canActivate({ req }: HttpContext) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;

  try {
    const { sub, tenantId } = await this.tokens.verify(header.slice('Bearer '.length));
    if (typeof sub !== 'string') return false;
    if (tenantId !== CURRENT_TENANT.get().id) return false;

    CURRENT_USER.set({ id: sub });
    return true;
  } catch {
    return false;
  }
}
```

Assim, um token da Acme usado em `globex.meuapp.com` responde 401.

Ao fazer login, procure o usuário **dentro da empresa atual**, não em todo o banco de dados, para que o mesmo email possa existir em duas empresas sem se misturar.

## Filtre todas as consultas

Cada tabela com dados de uma empresa tem uma coluna `tenant_id`, e cada consulta filtra por ela. Faça isso nos repositórios, lendo `CURRENT_TENANT`, para que nenhum serviço precise se lembrar disso:

```ts title="src/books/books.repository.ts"
findAll() {
  const { id } = CURRENT_TENANT.get();
  return this.database.db.select().from(books).where(eq(books.tenantId, id));
}

create(title: string) {
  const { id } = CURRENT_TENANT.get();
  return this.database.db.insert(books).values({ title, tenantId: id }).returning();
}
```

Esquecer um filtro basta para misturar dados de duas empresas. Como segunda barreira, o PostgreSQL permite definir [políticas de segurança por linha](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), que aplicam o filtro no próprio banco de dados.

`CURRENT_TENANT.get()` lança um erro se não houver empresa, em vez de devolver dados de todas. Fora de uma requisição, como em um script ou uma tarefa em segundo plano, abra um contexto com [`runInNewContext`](../../core/request-lifecycle/#fora-de-uma-requisição) e guarde a empresa antes de usar os repositórios.

## Registre uma empresa

O frontend pode sugerir o slug a partir do nome enquanto o usuário digita, e mostrar como ficará o endereço. Mas a validação é do backend, porque uma requisição pode ser enviada sem passar pelo seu frontend:

```ts title="src/tenants/tenants.schemas.ts"
import { z } from 'zod';

const RESERVED = ['www', 'api', 'admin', 'app', 'mail', 'static', 'status'];

export const CreateTenant = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
    .refine((slug) => !RESERVED.includes(slug)),
});
```

- **O formato** é o de um subdomínio válido: minúsculas, números e hífens, sem hífens no início nem no fim, e até 63 caracteres.
- **Os nomes reservados** evitam que alguém registre endereços como `admin.meuapp.com` ou `api.meuapp.com`. Adicione à lista os subdomínios que você usa.
- **Se já existe** é algo que só o banco de dados sabe: coloque uma restrição `UNIQUE` na coluna `slug`, e traduza o erro de chave duplicada para um 409 com um [interceptor](../../core/interceptors/#traduza-erros).

Tenha em conta que o slug faz parte do endereço da empresa, então mudá-lo depois quebra os links salvos.

## Atrás de um proxy

Com [`trustProxy`](../../security/client-ip/) ativado, `req.hostname` deixa de ler o cabeçalho `Host` e lê `X-Forwarded-Host`: uma requisição a `acme.meuapp.com` com `X-Forwarded-Host: globex.meuapp.com` é tratada como Globex.

Garanta que o seu proxy **sobrescreva** `X-Forwarded-Host` com o host real, em vez de repassar o que o cliente envia. E é mais um motivo pelo qual a verificação de pertencimento é imprescindível: mesmo que alguém falsifique o host, o token dele continua sendo da empresa dele.

## Cookies e CORS

Se você usa cookies de sessão, não defina o atributo `Domain` neles: assim o navegador só os envia ao subdomínio que os criou, e não às outras empresas.

Se o frontend de cada empresa está em seu próprio subdomínio, o CORS precisa aceitar essas origens. Compare com uma expressão exata, não com um simples `endsWith('meuapp.com')`, que também aceitaria `https://evilmeuapp.com`:

```ts
import cors from 'cors';

app.use(cors({ origin: /^https:\/\/[a-z0-9-]+\.meuapp\.com$/, credentials: true }));
```

## WebSocket

O handshake de um WebSocket não passa pelos middlewares, então `CURRENT_TENANT` não tem valor nele. Identifique a empresa em `authenticate`, a partir do cabeçalho `Host`, verifique se o usuário pertence a ela e guarde-a na conexão:

```ts
WebSocketModule.forRoot({
  authenticate: async (req) => {
    const session = await verifySession(req);
    const tenant = await findTenantByHost(req.headers.host);
    if (!session || !tenant || session.tenantId !== tenant.id) return false;
    return { userId: session.userId, tenantId: tenant.id };
  },
}),
```

Depois use `client.state.tenantId` nas mensagens, e adicione a empresa ao nome das salas, como `` `${tenantId}:general` ``, para que duas empresas não compartilhem uma mesma sala.
