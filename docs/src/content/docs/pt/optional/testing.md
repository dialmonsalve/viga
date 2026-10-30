---
title: viga/testing
description: Teste sua aplicação com requisições HTTP reais, substituindo os providers que você não quer usar nos testes, como o banco de dados ou um serviço externo.
sidebar:
  order: 7
---

`viga/testing` inicia sua aplicação em uma porta livre e permite fazer requisições HTTP reais a ela. As requisições passam por todo o percurso: guards, validação, interceptores, controllers e serviços, igual em produção. O que você não quer usar em um teste, como o banco de dados ou um serviço de pagamentos, você substitui por uma versão falsa.

Ele não traz um executor de testes próprio. Os exemplos usam `node:test`, o que vem com o Node.js, que não precisa instalar nada.

## Seu primeiro teste

```ts title="src/books/books.test.ts"
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createTestingApp } from 'viga/testing';
import { AppModule } from '../app.module.ts';

it('lista os livros', async () => {
  const app = await createTestingApp(AppModule);

  try {
    const { status, body } = await app.request('/books');
    assert.equal(status, 200);
    assert.deepEqual(body, [{ id: 1, title: 'Dune' }, { id: 2, title: 'Fundação' }]);
  } finally {
    await app.close();
  }
});
```

`createTestingApp` recebe o módulo raiz e devolve a aplicação já escutando em uma porta livre de `127.0.0.1`. `app.request()` faz uma requisição a ela e devolve o código de status, os cabeçalhos e o corpo, já convertido se a resposta for JSON.

`app.close()` para o servidor e fecha os providers. Coloque-o em um `finally` para que seja executado mesmo se o teste falhar; senão, o processo de testes pode ficar esperando.

## Execute os testes

O Node.js ainda não entende decorators, então os testes são executados com o `tsx`, o mesmo que você usa em desenvolvimento. Adicione um script ao seu `package.json`:

```json title="package.json"
{
  "scripts": {
    "test": "node --import tsx --test \"src/**/*.test.ts\""
  }
}
```

E execute-o com `pnpm test`, `npm test`, `yarn test` ou `bun run test`, conforme o seu gerenciador de pacotes.

## Uma aplicação para vários testes

Iniciar a aplicação em cada teste é o mais isolado, mas também o mais lento. Se os testes de um arquivo não afetam uns aos outros, compartilhe uma única aplicação com `before` e `after`:

```ts title="src/books/books.test.ts"
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTestingApp, type TestingApp } from 'viga/testing';
import { AppModule } from '../app.module.ts';

describe('livros', () => {
  let app: TestingApp;

  before(async () => {
    app = await createTestingApp(AppModule);
  });

  after(() => app.close());

  it('lista os livros', async () => {
    const { status } = await app.request('/books');
    assert.equal(status, 200);
  });

  it('responde 404 se o livro não existir', async () => {
    const { status } = await app.request('/books/99');
    assert.equal(status, 404);
  });
});
```

## Faça requisições

`app.request()` aceita o método, um corpo JSON e cabeçalhos:

```ts
const { status, body, headers } = await app.request('/books', {
  method: 'POST',
  json: { title: 'Dune', year: 1965 },
  headers: { authorization: 'Bearer token-de-teste' },
});

assert.equal(status, 201);
assert.equal(headers.get('x-request-id')?.length, 36);
```

Com `json`, o viga adiciona o cabeçalho `content-type: application/json` para você. Para enviar outro tipo de corpo, use `body` com um texto ou bytes, e defina o cabeçalho você mesmo.

Para tipar o corpo da resposta, passe o tipo: `app.request<Book[]>('/books')`.

## Substitua providers

A opção `overrides` substitui providers sem mexer no código da aplicação. Ela usa a mesma forma que os providers de um módulo, normalmente com `useValue`:

```ts
const app = await createTestingApp(AppModule, {
  overrides: [
    { provide: BOOKS_REPOSITORY, useValue: { findAll: async () => [{ id: 9, title: 'Livro de teste' }] } },
  ],
});
```

O controller e o serviço são os reais; só o repositório muda. Você viu isso em [repositórios](../../start/repositories/#substitua-o-nos-testes).

Algumas coisas que vale saber:

- **O provider original nunca é criado.** Se você substituir `DatabaseService`, a aplicação não abre nenhuma conexão com o banco de dados, nem mesmo ao iniciar.
- **Funciona em qualquer módulo**, incluindo os importados e os globais, sem mudar quais módulos podem vê-lo.
- **Um override que não corresponde a nenhum provider dá erro**, para que um token escrito errado não passe despercebido:

```txt
[Testing] The override for InjectionToken(BOOKS_REPOSITORY) does not match any provider; check that the token is the same one the module declares
```

### Mude a configuração

Para usar outra configuração nos testes sem mexer em `process.env`, substitua `CONFIG`:

```ts
import { CONFIG } from 'viga/config';

const app = await createTestingApp(AppModule, {
  overrides: [{ provide: CONFIG, useValue: { PORT: 0, DATABASE_URL: 'postgres://localhost/test', JWT_SECRET: 'x'.repeat(32) } }],
});
```

Esse valor não é validado com o schema de [`viga/config`](../config/): escreva um objeto completo e correto.

## A autenticação nos testes

`createTestingApp` mantém os valores padrão de produção: as rotas privadas respondem 401 até você configurar um guard de autenticação, e `requireValidation` e a proteção CSRF continuam ativas. Assim os testes detectam os mesmos erros que você veria em produção.

Para testar rotas privadas, use `configure`, que recebe a aplicação antes de iniciar. Com um guard falso que sempre deixa passar e guarda um usuário de teste, seus serviços funcionam como com um usuário real:

```ts
import { CURRENT_USER } from '../auth/current-user.ts';

const app = await createTestingApp(AppModule, {
  configure: (app) =>
    app.useAuthGuard(() => {
      CURRENT_USER.set({ id: 1, role: 'admin' });
      return true;
    }),
});
```

Para testar que uma rota rejeita quem não está autenticado, crie outra aplicação sem `configure` e verifique que ela responde 401.

`createTestingApp` aceita as mesmas opções que `createApp`, como `globalPrefix`. Por padrão usa um logger silencioso para não encher a saída dos testes; passe `logger` se quiser ver os logs.

## Outras ferramentas

- `app.get(token)` devolve um provider que o módulo raiz pode ver, por exemplo para preparar dados antes de uma requisição ou verificar o estado depois.
- `app.url(path)` devolve a URL completa, como `http://127.0.0.1:41235/books`, para usá-la com outro cliente HTTP. Para um WebSocket, troque `http://` por `ws://`.
- `app.app` é a aplicação viga por trás, caso você precise de algo que `createTestingApp` não expõe.
