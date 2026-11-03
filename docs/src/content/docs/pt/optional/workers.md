---
title: viga/workers
description: Execute trabalho em segundo plano com o mesmo código dentro da API, em processos filhos ou em outro servidor, com um supervisor que reinicia os que caem.
head:
  - tag: title
    content: 'Trabalho em segundo plano em Node.js com viga/workers'
sidebar:
  order: 11
---

Um worker é a parte da sua aplicação que faz trabalho em segundo plano, fora das requisições: importar um CSV, enviar emails ou gerar relatórios. O `viga/workers` permite escrevê-lo uma vez e decidir depois onde ele é executado. Ele também traz um supervisor que cria um processo para cada chave, por exemplo um por empresa, e o reinicia se cair.

**Não é um sistema de filas.** O viga não guarda trabalhos, não os repete nem os agenda: para isso, use uma biblioteca como BullMQ ou pg-boss. O que o `viga/workers` faz é iniciar, parar e vigiar o processo onde essa biblioteca é executada.

## Escreva o worker

Um worker é um provider normal: começa a consumir trabalhos em `onModuleInit` e para em `onModuleDestroy`. `WORKER_KEY` indica qual chave ele atende:

```ts title="src/imports/imports.worker.ts"
import { Injectable, inject, runInNewContext, type OnModuleDestroy, type OnModuleInit } from 'viga';
import { WORKER_KEY } from 'viga/workers';
import { Worker, type Job } from 'bullmq';

@Injectable()
export class ImportsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly key = inject(WORKER_KEY);
  private readonly imports = inject(ImportsService);
  private queue?: Worker;

  onModuleInit() {
    this.queue = new Worker(`imports-${this.key}`, (job) => this.process(job), { connection });
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }

  private async process(job: Job) {
    return runInNewContext(() => this.imports.run(job.data));
  }
}
```

`runInNewContext` dá a cada trabalho seu próprio [contexto](../../core/request-lifecycle/#fora-de-uma-requisição), como se fosse uma requisição, para que um trabalho não veja os valores de outro.

Agrupe-o no módulo dele, sem controladores nem nada que dependa de HTTP:

```ts title="src/imports/imports-worker.module.ts"
import { Module } from 'viga';

@Module({
  imports: [ImportsModule],
  providers: [ImportsWorker],
})
export class ImportsWorkerModule {}
```

## Escolha onde ele é executado

| Modo | Isolamento | Quando usar |
| --- | --- | --- |
| [Dentro da API](#dentro-da-api) | Nenhum: compartilha o processo com as suas rotas. | Trabalho leve de entrada e saída, e desenvolvimento. |
| [Processos filhos](#processos-filhos) | Uma falha ou um uso alto de CPU não para a API. | Uma única máquina, ou um processo por empresa. |
| [Outro servidor](#outro-servidor) | Também isola a memória e a máquina. | Quando você precisa escalar os workers separadamente da API. |

O trabalho que usa muita CPU, como processar um CSV de 100 000 linhas, precisa pelo menos de um processo à parte. O Node.js executa o seu código em uma única thread: dentro da API, todas as requisições esperariam ele terminar.

### Dentro da API

Importe o módulo na API, com a chave que ele atende:

```ts title="src/app.module.ts"
import { WorkerModule } from 'viga/workers';

@Module({
  imports: [WorkerModule.forKey('emails'), ImportsWorkerModule],
})
export class AppModule {}
```

### Processos filhos

Crie um arquivo de entrada para o worker:

```ts title="src/worker.ts"
import { startWorker } from 'viga/workers';
import { ImportsWorkerModule } from './imports/imports-worker.module.ts';

await startWorker(ImportsWorkerModule);
```

E adicione o supervisor à API:

```ts title="src/app.module.ts"
import { WorkersModule } from 'viga/workers';

WorkersModule.forRoot({
  entry: new URL('./worker.ts', import.meta.url),
  keys: ['imports', 'reports'],
}),
```

Escreva o caminho com `.ts`: se depois de compilar só existir `worker.js`, o viga usa esse.

`ImportsWorkerModule` é a raiz do processo filho, então importe nele os [módulos globais](../../core/modules/#módulos-globais) de que precisar, como `ConfigModule`. O processo filho inicia a própria aplicação, com seus próprios providers e conexões: não compartilha memória com a API.

### Outro servidor

O mesmo arquivo de entrada é executado por conta própria, com a chave como argumento:

```sh
node dist/worker.js emails
```

É o adequado com Docker, systemd ou Kubernetes, que já reiniciam os processos que caem, e `startWorker` responde a `SIGTERM` com um encerramento ordenado:

```dockerfile
CMD ["node", "dist/worker.js", "emails"]
```

Se nesse servidor você precisar de um processo por empresa, use `WorkersModule` em uma aplicação que chame `init()` em vez de `listen()`.

## Um worker por empresa

Se cada empresa tem a própria fila, a lista de chaves vem do seu banco de dados. Passe uma função para `forRoot`, que pode pedir providers dos módulos globais com `inject()`:

```ts title="src/app.module.ts"
WorkersModule.forRoot(() => {
  const tenants = inject(TenantsService);

  return {
    entry: new URL('./worker.ts', import.meta.url),
    keys: () => tenants.slugs(),
    maxWorkers: 20,
  };
}),
```

Com `WorkerSupervisor` você gerencia os workers com a aplicação em execução, por exemplo ao cadastrar uma empresa:

```ts
import { WorkerSupervisor } from 'viga/workers';

private readonly workers = inject(WorkerSupervisor);

async createTenant(data: NewTenant) {
  const tenant = await this.tenants.create(data);
  await this.workers.start(tenant.slug);
  return tenant;
}
```

| Método | O que faz |
| --- | --- |
| `start(key)` | Inicia um worker. Se já existir, não faz nada. |
| `stop(key)` | Para o worker e espera ele terminar. Se não existir, não faz nada. |
| `list()` | Devolve `key`, `status` (`running`, `restarting` ou `stopping`), `pid` e `restarts` de cada um. |

A chave chega ao worker como argumento e só aceita letras, números, `.`, `_`, `:` e `-`, então um slug válido serve como está. Dentro do worker, use `WORKER_KEY` para escolher a fila e guardar a empresa no contexto de cada trabalho:

```ts
private async process(job: Job) {
  return runInNewContext(async () => {
    CURRENT_TENANT.set(await this.tenants.findBySlug(this.key));
    return this.imports.run(job.data);
  });
}
```

### Quanta memória consome

Cada worker é um processo do Node.js com a própria cópia da sua aplicação. Um processo viga inativo, sem mais dependências que o próprio viga, usa cerca de 80 MiB de memória residente, e as suas dependências e dados se somam a isso. Parte dessa memória é compartilhada entre processos, então o custo real é um pouco menor, mas meça na sua aplicação antes de decidir.

Por isso `maxWorkers` vale 8 por padrão, e ultrapassá-lo dá um erro em vez de esgotar a memória da máquina. Aumente-o quando souber que a sua máquina os suporta. Se forem muitas empresas e a maioria ficar inativa quase sempre, uma única fila compartilhada com a empresa em cada trabalho gasta muito menos.

O isolamento de CPU tem outro limite: só se mantém enquanto houver menos workers ativos que núcleos.

## Quando um worker falha

O supervisor reinicia um worker que termina com erro, e registra cada queda:

```txt
[Workers] The worker imports exited with code 1; restarting it in 1000 ms
```

A espera começa em 1 segundo e dobra a cada queda até 30 segundos, para que um worker que falha ao iniciar não consuma a máquina. Se ele ficou funcionando pelo menos 60 segundos, volta a 1 segundo. Um worker que termina com código 0 é considerado encerrado de propósito, e não é reiniciado.

Um reinício não recupera o trabalho que estava em andamento. Isso depende da sua biblioteca de filas, que normalmente o entrega de novo, então um trabalho precisa poder ser repetido sem efeitos duplicados.

## Ao parar

Quando a aplicação para, o supervisor envia `SIGTERM` para cada worker, que encerra de forma ordenada executando seus `onModuleDestroy`. Isso ocorre depois que as requisições em andamento terminam.

Se um worker não terminar em 30 segundos, o supervisor o fecha à força com `SIGKILL` e registra isso. Mude com `stopTimeoutMs`, de acordo com o que o seu trabalho mais longo demora, e mantenha-o abaixo do tempo que a sua plataforma dá para terminar. Caso contrário, a plataforma para o processo antes.

Se o processo pai morrer de repente, sem chance de avisar, os workers dele detectam isso e se fecham sozinhos, então não ficam processos órfãos. Se esse encerramento travar, o worker termina à força depois de 30 segundos, ou o que você indicar em `startWorker(Module, { orphanTimeoutMs })`.

## Variáveis de ambiente e argumentos

Um worker herda as variáveis de ambiente do processo que o cria, e também seus argumentos do Node.js. Por isso funciona igual com `node --import tsx` ou com `tsx` e com o código compilado. As exceções são `--inspect` e `--watch`: todos os processos competiriam pela mesma porta, e `--watch` reiniciaria cada um por conta própria.

As duas coisas podem ser alteradas:

```ts
WorkersModule.forRoot({
  entry: new URL('./worker.ts', import.meta.url),
  env: { ...process.env, LOG_LEVEL: 'warn' },
  execArgv: ['--max-old-space-size=512'],
}),
```

Se você usa `process.loadEnvFile()` em `main.ts`, os filhos recebem essas variáveis. Um worker executado [por conta própria](#outro-servidor) precisa carregá-las ele mesmo.

## Nos testes

Teste a lógica do worker sem processos, entregando a chave com `WorkerModule.forKey`:

```ts title="test/imports.test.ts"
import { createTestingApp } from 'viga/testing';
import { WorkerModule } from 'viga/workers';

@Module({ imports: [WorkerModule.forKey('test'), ImportsWorkerModule] })
class TestModule {}

const app = await createTestingApp(TestModule, {
  overrides: [{ provide: ImportsService, useValue: fakeImports }],
});
```
