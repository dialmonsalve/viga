---
title: Ciclo de vida de uma requisição
description: O percurso completo de uma requisição no viga, desde que chega até a resposta, os middlewares do Express e o contexto de cada requisição.
sidebar:
  order: 7
---

As páginas anteriores explicam cada peça separadamente. Esta mostra como elas se encaixam: o que acontece com uma requisição desde que chega até a resposta sair, e em que ordem.

## O percurso

O viga processa cada requisição nesta ordem. Se um passo a rejeitar, os seguintes não são executados e o viga responde com o erro desse passo:

| Passo | O que faz | Se rejeitar |
| --- | --- | --- |
| 1. Id da requisição | Atribui um id e o adiciona ao cabeçalho `X-Request-Id`. | |
| 2. Cabeçalhos de segurança | Adiciona os cabeçalhos de segurança à resposta. | |
| 3. Middlewares do Express | Executa os que você adicionou com `app.use()`. | O que cada middleware decidir |
| 4. Verificação CSRF | Rejeita formulários enviados de outro site. | 403 |
| 5. Autenticação | Executa o [guard de autenticação](../guards/#o-guard-de-autenticação), exceto em rotas `@Public()`. | 401 |
| 6. Leitura do corpo | Lê o corpo da requisição. | 400 se o JSON estiver malformado ou a rota não aceitar corpo, 413 se for grande demais |
| 7. Guards da rota | Executa os `@UseGuards()` da classe e depois os do método. | 403, ou 429 com `@RateLimit` |
| 8. Interceptores | Entra nos [interceptores](../interceptors/): globais, da classe e do método. | |
| 9. Validação | Valida os dados com `@Validate`. | 400 |
| 10. Método | Executa o método do controller. | O erro que ele lançar |

Depois, o resultado volta pelos interceptores em ordem inversa e o viga envia a resposta, como explicado em [controllers](../controllers/#a-resposta). Se algo lançar um erro em qualquer passo, o viga o converte em uma resposta de erro com o formato de [exceções](../exceptions/).

Se a rota não existir, a requisição não passa do passo 4: responde 404, ou 401 se a aplicação tiver autenticação e a requisição não trouxer sessão.

### Por que o corpo é lido depois da autenticação

Ler o corpo custa memória e tempo. Como ele é lido depois do passo 5, uma requisição anônima a uma rota privada recebe 401 sem que o servidor chegue a lê-lo, e uma rota que não existe nunca o lê. Assim, quem não está autenticado não consegue fazer o servidor trabalhar enviando corpos grandes para rotas privadas.

Os guards da rota veem o corpo, porque são executados depois. Isso permite, por exemplo, limitar as tentativas de login por email.

### A ordem não depende de como você escreve os decorators

Os decorators de um método seguem a ordem da tabela mesmo que você os escreva em outra:

```ts
@Post()
@Validate({ body: CreateBook })
@UseGuards(AdminGuard)
create({ body }: HttpContext<{ body: typeof CreateBook }>) {
  return this.books.create(body);
}
```

Aqui `AdminGuard` é executado antes da validação, mesmo estando escrito abaixo. Um usuário sem permissão recebe 403 antes de seu corpo ser validado, então não pode usar as mensagens de validação para descobrir o que a rota espera. Entre vários decorators do mesmo tipo, o de cima é executado primeiro.

## Middlewares do Express

O viga funciona sobre o Express, então você pode usar qualquer middleware do Express com `app.use()`, antes de `listen()`:

```ts title="src/main.ts"
import cors from 'cors';
import { createApp } from 'viga';
import { AppModule } from './app.module.ts';

const app = createApp({ rootModule: AppModule, globalPrefix: '/api' }).enableShutdownHooks();

app.use(cors({ origin: 'https://meu-frontend.com', credentials: true }));

await app.listen();
```

Os middlewares são executados no passo 3, para todas as requisições, incluindo as de rotas que não existem. Isso tem duas consequências:

- **Ainda não há corpo.** `req.body` é `undefined` em um middleware, porque o corpo é lido no passo 6.
- **Ainda não há autenticação.** Não use um middleware para decidir permissões: para isso existem os guards.

Como são executados depois dos cabeçalhos de segurança, um middleware pode alterá-los se você precisar.

## O contexto da requisição

Em [guards](../guards/#compartilhe-o-usuário-com-o-resto-do-código) você usou `CURRENT_USER` para que qualquer código conheça o usuário sem recebê-lo como parâmetro. `CURRENT_USER` é uma chave de contexto, criada com `createContextKey`:

```ts title="src/auth/current-user.ts"
import { createContextKey } from 'viga';

export const CURRENT_USER = createContextKey<User>('currentUser');
```

Cada requisição tem seu próprio contexto. Mesmo que o servidor atenda centenas de requisições ao mesmo tempo, cada uma vê só os seus valores. Isso funciona com o `AsyncLocalStorage` do Node.js, que acompanha a requisição através de todos os `await`.

Uma chave tem quatro métodos:

| Método | O que faz |
| --- | --- |
| `get()` | Devolve o valor, ou lança um erro se não houver. |
| `find()` | Devolve o valor, ou `undefined` se não houver. |
| `set(value)` | Guarda o valor para o resto da requisição. Funciona em middlewares, guards, interceptores, controllers e serviços. |
| `run(value, fn)` | Executa `fn` com esse valor e, ao terminar, restaura o anterior. |

Um caso comum é registrar quem cria ou modifica algo, sem que o controller precise passar o usuário ao serviço:

```ts title="src/books/books.service.ts"
import { Injectable } from 'viga';
import { CURRENT_USER } from '../auth/current-user.ts';

@Injectable()
export class BooksService {
  create(data: NewBook) {
    const { id } = CURRENT_USER.get();
    return this.repository.insert({ ...data, createdBy: id, updatedBy: id });
  }
}
```

### O id da requisição

O viga guarda o id de cada requisição em `REQUEST_ID`, uma chave de contexto que já vem com ele. Use-o para relacionar seus logs a uma requisição específica:

```ts
import { REQUEST_ID } from 'viga';

this.logger.info('Livro criado', { requestId: REQUEST_ID.get(), bookId: book.id });
```

É o mesmo id do cabeçalho `X-Request-Id` e do campo `requestId` das respostas de erro. Ele é configurado com a opção `requestId` de `createApp`:

| Opção | Padrão | O que faz |
| --- | --- | --- |
| `header` | `'X-Request-Id'` | O cabeçalho onde o id é enviado. |
| `trustIncoming` | `false` | Reutiliza o id que a requisição traz, se tiver um formato seguro. Ative só atrás de um proxy que gere esse id, porque senão qualquer cliente pode escolher o seu. |
| `generate` | `randomUUID` | A função que gera os ids. |

Com `requestId: false` nenhum id é gerado.

### Fora de uma requisição

Em um script, uma tarefa agendada ou um teste não há requisição, então também não há contexto, e `set()` falha:

```txt
[Context] set("currentUser") can only be called inside a request or inside runInNewContext()
```

`runInNewContext` abre um contexto vazio onde `set()` e `get()` funcionam:

```ts title="scripts/import-books.ts"
import { runInNewContext } from 'viga';

await runInNewContext(async () => {
  CURRENT_USER.set(systemUser);
  await booksService.importFromCsv('books.csv');
});
```

Assim, o mesmo serviço que usa `CURRENT_USER.get()` nas requisições também funciona a partir de um script.
