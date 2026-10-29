---
title: Ciclo de vida da aplicação
description: Como uma aplicação viga inicia e para, os hooks dos providers e o encerramento ordenado ao receber um sinal.
sidebar:
  order: 8
---

Uma aplicação viga passa por três etapas: inicia, atende requisições e para. Esta página explica o que acontece ao iniciar e ao parar, e como um provider pode executar código nesses momentos, por exemplo para se conectar a um banco de dados e fechar a conexão no final.

## Iniciar

`listen()` inicia a aplicação e começa a escutar:

```ts title="src/main.ts"
const app = createApp({ rootModule: AppModule, globalPrefix: '/api' }).enableShutdownHooks();

await app.listen();
```

Ao chamá-lo, o viga:

1. Carrega os módulos e cria todos os providers.
2. Executa o hook `onModuleInit` de cada provider que o tiver.
3. Registra as rotas dos controllers.
4. Executa os hooks `onServerListen`.
5. Começa a escutar na porta.

Se algo falhar nos passos 1 a 4, a aplicação não chega a abrir a porta e `listen()` lança o erro.

`listen()` escuta na porta 3000 se você não passar outra. `listen(8080)` usa essa porta, `listen(8080, '127.0.0.1')` também escolhe a interface, e `listen(0)` pega uma porta livre aleatória, útil em testes. O viga não lê a variável de ambiente `PORT` por conta própria; se você a usa, passe-a você mesmo: `app.listen(Number(process.env.PORT ?? 3000))`.

### Iniciar sem servidor

`init()` faz os passos 1 a 3 sem abrir nenhuma porta. Serve para scripts, tarefas agendadas ou workers que usam seus serviços sem atender requisições HTTP. Com `app.get()` você obtém qualquer provider:

```ts title="scripts/import-books.ts"
import { createApp, runInNewContext } from 'viga';
import { AppModule } from '../src/app.module.ts';
import { BooksService } from '../src/books/books.service.ts';

const app = await createApp({ rootModule: AppModule }).init();

await runInNewContext(() => app.get(BooksService).importFromCsv('books.csv'));

await app.close();
```

`app.get()` procura a partir do módulo raiz, então só encontra o que esse módulo enxerga: seus próprios providers, os que os módulos importados exportam e os dos módulos globais. Se `BooksService` não for exportado por `BooksModule`, `app.get(BooksService)` falha com o mesmo erro de um `inject()` que não encontra seu provider.

`runInNewContext` abre um contexto para que os serviços que usam [chaves de contexto](../request-lifecycle/#o-contexto-da-requisição) funcionem fora de uma requisição.

## Os hooks dos providers

Um provider pode implementar estas interfaces para executar código em cada etapa:

| Interface | Método | Quando é executado |
| --- | --- | --- |
| `OnModuleInit` | `onModuleInit()` | Ao iniciar, depois de criar todos os providers. |
| `OnServerListen` | `onServerListen(server)` | Logo antes de o servidor começar a escutar. |
| `OnServerClose` | `onServerClose()` | Quando o servidor começa a fechar. |
| `OnModuleDestroy` | `onModuleDestroy()` | Ao parar, depois de fechar o servidor. |

Os métodos podem ser `async`: o viga espera que terminem antes de continuar.

O caso mais comum é uma conexão que é aberta ao iniciar e fechada no final:

```ts title="src/database/database.service.ts"
import { Injectable, type OnModuleDestroy, type OnModuleInit } from 'viga';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });

  async onModuleInit() {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
```

`onModuleInit` verifica se o banco de dados responde. Se não responder, a aplicação não inicia, e você descobre isso no deploy em vez de na primeira requisição. Este é o lugar para o trabalho assíncrono que não pode ir em um [`useFactory`](../providers/#usefactory-construir-o-valor-com-código), que precisa devolver o valor diretamente.

`OnServerListen` e `OnServerClose` são para providers que precisam do servidor HTTP, por exemplo para atender WebSockets na mesma porta. `onServerListen` recebe o `Server` do Node.js antes de ele começar a escutar. É o que `viga/websocket` usa.

### A ordem

O viga executa os `onModuleInit` em ordem de dependências: se `CacheService` usa `DatabaseService`, o hook de `DatabaseService` termina antes de o de `CacheService` começar. Assim, quando um provider é inicializado, tudo o que ele usa já está pronto.

Os `onModuleDestroy` são executados na ordem inversa: primeiro `CacheService` e depois `DatabaseService`. Assim nenhum provider perde uma dependência enquanto ainda está fechando.

## Parar

`close()` para a aplicação de forma ordenada:

1. O servidor deixa de aceitar conexões novas e fecha as que estão inativas.
2. Os hooks `onServerClose` são executados.
3. O viga espera as requisições em andamento terminarem.
4. Os hooks `onModuleDestroy` são executados, em ordem inversa.

Se um `onModuleDestroy` falhar, o viga continua fechando os demais e, no final, `close()` lança um `AggregateError` com todos os erros. Assim, uma falha ao fechar o cache não deixa aberta a conexão com o banco de dados.

Se a aplicação falhou no meio da inicialização, `close()` só fecha os providers cujo `onModuleInit` terminou. Um provider que nunca chegou a abrir sua conexão não tenta fechá-la.

### Ao receber um sinal

Quando você para a aplicação com `Ctrl+C`, ou quando o Docker ou o Kubernetes a param para fazer deploy de uma versão nova, o sistema envia um sinal ao processo. `enableShutdownHooks()` faz o viga chamar `close()` ao receber `SIGTERM` ou `SIGINT`, em vez de terminar de repente:

```ts
const app = createApp({ rootModule: AppModule }).enableShutdownHooks();
```

Depois de fechar, o processo termina com o código padrão do sinal: 143 para `SIGTERM` e 130 para `SIGINT`, ou 1 se o encerramento falhou. Ele termina mesmo que algo mantenha o processo vivo, como um temporizador esquecido, e funciona também quando o Node.js é o processo principal de um contêiner.

Sem `enableShutdownHooks()`, um sinal termina o processo sem executar os `onModuleDestroy`: as requisições em andamento são cortadas e as conexões não são fechadas corretamente. Ative-o sempre em `main.ts`.

Se você precisar de outros sinais, passe-os como argumento: `enableShutdownHooks(['SIGTERM', 'SIGINT', 'SIGHUP'])`.
