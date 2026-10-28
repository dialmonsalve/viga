---
title: Guards
description: Como o viga decide se uma requisição pode chegar a uma rota, com o guard de autenticação, @Public() e os guards de cada rota.
sidebar:
  order: 4
---

Um guard decide se uma requisição pode seguir até o método do controller. Ele devolve `true` para deixá-la passar ou `false` para rejeitá-la.

O viga tem dois tipos de guards:

- **O guard de autenticação**, um para toda a aplicação. Responde à pergunta "quem é você?" e protege todas as rotas, exceto as marcadas com `@Public()`.
- **Os guards de cada rota**, que você coloca com `@UseGuards()`. Respondem à pergunta "você pode fazer isso?", por exemplo se o usuário é administrador.

## Rotas privadas por padrão

No viga todas as rotas são privadas. Se a aplicação não tiver um guard de autenticação, as rotas privadas respondem 401, e ao iniciar o viga avisa quantas são:

```txt
No auth guard is configured, so the 3 private routes will respond 401; add app.useAuthGuard() or mark public routes with @Public()
```

Assim nenhuma rota fica aberta por esquecimento. Para abrir uma, marque-a com `@Public()`, sobre o método ou sobre a classe inteira. Você viu isso em [controllers](../controllers/#rotas-privadas-por-padrão).

## O guard de autenticação

Um guard é uma classe com um método `canActivate`, que recebe o mesmo contexto que os métodos do controller:

```ts title="src/auth/auth.guard.ts"
import { Injectable, inject, type CanActivate, type HttpContext } from 'viga';
import { SessionsService } from './sessions.service.ts';
import { CURRENT_USER } from './current-user.ts';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly sessions = inject(SessionsService);

  async canActivate({ req }: HttpContext) {
    const user = await this.sessions.findUser(req.headers.authorization);
    if (!user) return false;
    CURRENT_USER.set(user);
    return true;
  }
}
```

Ele é registrado uma única vez, em `main.ts`:

```ts title="src/main.ts" ins={7}
import { createApp } from 'viga';
import { AppModule } from './app.module.ts';
import { AuthGuard } from './auth/auth.guard.ts';

const app = createApp({ rootModule: AppModule, globalPrefix: '/api' })
  .enableShutdownHooks()
  .useAuthGuard(AuthGuard);

await app.listen();
```

O viga executa este guard antes de cada rota privada. Se ele devolver `false`, o viga responde 401 e o método não é executado. Como verificar a sessão ou o token é decisão sua: o viga não traz JWT nem sessões, e você pode usar a biblioteca que preferir.

`AuthGuard` pode pedir providers com `inject()` e não precisa ser declarado em `providers`: o viga o cria com o contêiner do módulo raiz, então ele pode pedir o que esse módulo enxerga, incluindo os módulos globais.

### Compartilhe o usuário com o resto do código

O guard guarda o usuário em `CURRENT_USER`, uma chave de contexto. Qualquer código executado durante essa requisição pode lê-lo sem recebê-lo como parâmetro:

```ts title="src/auth/current-user.ts"
import { createContextKey } from 'viga';

export interface User {
  id: number;
  role: 'admin' | 'editor' | 'reader';
}

export const CURRENT_USER = createContextKey<User>('currentUser');
```

```ts title="src/books/books.controller.ts"
@Get('/mine')
mine() {
  return this.books.findByOwner(CURRENT_USER.get().id);
}
```

`CURRENT_USER.get()` devolve um `User`, não um `User | undefined`, então você não precisa verificá-lo nem escrever `!`. Se você vem do NestJS, é o que substitui `req.user!.id`: lá `req.user` é opcional para o TypeScript mesmo que o guard já o tenha preenchido. Se por um erro de configuração não houver usuário, `get()` lança um erro claro em vez de deixar passar um `undefined`.

Cada requisição tem seu próprio valor: duas requisições simultâneas nunca veem o usuário da outra. As chaves de contexto são explicadas em detalhe no ciclo de vida de uma requisição.

:::caution
Em uma rota `@Public()` o guard de autenticação não é executado, então `CURRENT_USER` não tem valor mesmo que a requisição traga uma sessão válida. `CURRENT_USER.get()` lança um erro se não houver valor; em código que também roda em rotas públicas, use `CURRENT_USER.find()`, que devolve `undefined`.
:::

## Guards por rota

Saber quem você é não basta para tudo. Para verificar permissões, adicione guards com `@UseGuards()`:

```ts title="src/auth/admin.guard.ts"
import { Injectable, type CanActivate } from 'viga';
import { CURRENT_USER } from './current-user.ts';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate() {
    return CURRENT_USER.get().role === 'admin';
  }
}
```

```ts title="src/books/books.controller.ts"
@Delete('/:id')
@UseGuards(AdminGuard)
remove({ params }: HttpContext) {
  this.books.remove(Number(params.id));
}
```

Se um guard de `@UseGuards()` devolver `false`, o viga responde **403**, não 401: o usuário está autenticado, mas não tem permissão. Como o guard de autenticação já foi executado, `AdminGuard` pode usar `CURRENT_USER.get()` com segurança.

`@UseGuards()` também vai sobre a classe, e então protege todas as rotas do controller. Ele aceita vários guards, que são executados em ordem: `@UseGuards(AdminGuard, ActiveAccountGuard)`.

### Guards como funções

Se o guard não precisa de providers, ele pode ser uma função:

```ts
const isAdmin = () => CURRENT_USER.get().role === 'admin';

@UseGuards(isAdmin)
```

Funciona igual à classe. Use uma classe quando precisar de `inject()`.

### Outra resposta que não seja 403

Para responder com outro código, lance uma exceção em vez de devolver `false`. O viga responde com a exceção que você lançar:

```ts
canActivate() {
  if (this.maintenance.isActive()) throw new ServiceUnavailableException();
  return CURRENT_USER.get().role === 'admin';
}
```

### Crie seus próprios decorators

Se você repete a mesma combinação de guards em várias rotas, agrupe-a em uma função que devolva `UseGuards()`:

```ts title="src/auth/admin-only.ts"
import { UseGuards } from 'viga';
import { ActiveAccountGuard } from './active-account.guard.ts';
import { AdminGuard } from './admin.guard.ts';

export const AdminOnly = () => UseGuards(ActiveAccountGuard, AdminGuard);
```

```ts title="src/books/books.controller.ts"
@Delete('/:id')
@AdminOnly()
remove({ params }: HttpContext) {
  this.books.remove(Number(params.id));
}
```

Funciona sobre o método e sobre a classe, igual a `@UseGuards()`.

Se o decorator precisa de parâmetros, a função os recebe e cria o guard com eles:

```ts title="src/auth/roles.ts"
import { UseGuards } from 'viga';
import { CURRENT_USER, type User } from './current-user.ts';

export const Roles = (...roles: User['role'][]) =>
  UseGuards(() => roles.includes(CURRENT_USER.get().role));
```

```ts
@Post()
@Roles('admin', 'editor')
create({ body }: HttpContext<{ body: typeof CreateBook }>) {
  return this.books.create(body);
}
```

Se além disso o guard precisa de providers, crie a classe dentro da função. Cada chamada cria sua própria classe com os parâmetros que recebeu, e essa classe pode usar `inject()`:

```ts title="src/billing/require-plan.guard.ts"
import { Injectable, inject, type CanActivate } from 'viga';
import { CURRENT_USER } from '../auth/current-user.ts';
import { BillingService, type Plan } from './billing.service.ts';

export function RequirePlan(plan: Plan) {
  @Injectable()
  class RequirePlanGuard implements CanActivate {
    private readonly billing = inject(BillingService);

    async canActivate() {
      return (await this.billing.planOf(CURRENT_USER.get().id)) === plan;
    }
  }
  return RequirePlanGuard;
}
```

Ele se combina com outros guards como qualquer outro:

```ts title="src/billing/pro-only.ts"
import { UseGuards } from 'viga';
import { ActiveAccountGuard } from '../auth/active-account.guard.ts';
import { RequirePlan } from './require-plan.guard.ts';

export const ProOnly = () => UseGuards(ActiveAccountGuard, RequirePlan('pro'));
```

E se você quiser que cada rota escolha o plano, passe-o pelo decorator: `export const PlanOnly = (plan: Plan) => UseGuards(ActiveAccountGuard, RequirePlan(plan))`, e na rota `@PlanOnly('pro')`.

Esses decorators são funções normais, então recebem qualquer valor: arrays, se você definir `Roles` como `(roles: User['role'][]) => ...` e usá-lo com `@Roles(['admin', 'editor'])`, ou objetos de opções, como `RequirePlan({ plan: 'pro', allowTrial: true })`. Um objeto compensa quando há vários parâmetros ou algum é opcional, porque se entende sem olhar a definição.

:::caution
Os argumentos do decorator são avaliados uma única vez, ao carregar a classe, não em cada requisição. Passe só valores fixos. O que depende da requisição, como o usuário, os parâmetros ou os cabeçalhos, é lido dentro de `canActivate`.
:::

Se você vem do NestJS, isso substitui `applyDecorators()` e a combinação de `@SetMetadata()` com um guard que lê os papéis. No viga o guard recebe os papéis diretamente e lê o usuário de `CURRENT_USER`, então não são necessários metadados à parte.

## A ordem em que são executados

Para uma rota privada, o viga executa os guards nesta ordem e para no primeiro que rejeitar:

1. O guard de autenticação. Se rejeitar: 401.
2. Os guards de `@UseGuards()` sobre a classe. Se algum rejeitar: 403.
3. Os guards de `@UseGuards()` sobre o método. Se algum rejeitar: 403.

Em uma rota `@Public()` só o passo 1 é pulado. Os guards de `@UseGuards()` são executados mesmo assim: `@Public()` tira a autenticação, não as permissões.

## `@Public()` não é herdado

Se um controller estende outro marcado com `@Public()`, o filho é privado até repetir `@Public()`. O mesmo acontece com um método que sobrescreve outro público. As rotas e os guards são herdados.

Assim, estender uma classe pública nunca abre rotas novas por acidente.

## Rotas que não existem

Quando a aplicação tem um guard de autenticação, uma rota que não existe responde igual a uma privada: 401 para quem não tem sessão e 404 para quem tem. Assim, quem não está autenticado não consegue descobrir quais rotas existem testando URLs.

Esse comportamento se chama `concealRoutes` e é ativado sozinho ao usar `useAuthGuard()`. Você pode forçá-lo com `createApp({ concealRoutes: true })` ou desativá-lo com `false`.

## Revise quais rotas são públicas

Ao iniciar, o viga lista as rotas públicas no log, com nível `debug`:

```txt
Public routes: GET /api/books, POST /api/auth/login
```

Revise-a antes de cada deploy: é a lista de tudo o que qualquer pessoa pode chamar sem se autenticar.
