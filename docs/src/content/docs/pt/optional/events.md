---
title: viga/events
description: Separe seus serviços com um barramento de eventos em memória, com eventos tipados, erros isolados e listeners que terminam antes de a aplicação ser encerrada.
head:
  - tag: title
    content: 'Barramento de eventos em Node.js com viga/events'
sidebar:
  order: 10
---

Quando algo acontece na sua aplicação, muitas vezes várias partes precisam reagir. Se `CampaignsService` chama diretamente os serviços de email, de estatísticas e de auditoria, ele precisa conhecer todos. Com o `viga/events`, ele só anuncia o que aconteceu, e cada parte interessada se inscreve por conta própria.

Os eventos vivem na memória do processo. Antes de usá-los, leia [o que eles não fazem](#o-que-ele-não-faz).

## Comece

Importe `EventsModule` no módulo raiz. É um módulo global, então `EventBus` fica disponível em toda a aplicação:

```ts title="src/app.module.ts"
import { Module } from 'viga';
import { EventsModule } from 'viga/events';

@Module({
  imports: [EventsModule.forRoot()],
})
export class AppModule {}
```

Um evento é uma classe com os dados do que aconteceu. O nome descreve algo que já ocorreu:

```ts title="src/campaigns/campaign-paused.event.ts"
export class CampaignPaused {
  constructor(
    readonly campaignId: number,
    readonly bounceRate: number,
  ) {}
}
```

Emita-o com `EventBus`:

```ts title="src/campaigns/campaigns.service.ts"
import { Injectable, inject } from 'viga';
import { EventBus } from 'viga/events';
import { CampaignPaused } from './campaign-paused.event.ts';

@Injectable()
export class CampaignsService {
  private readonly events = inject(EventBus);

  async pause(campaignId: number, bounceRate: number) {
    await this.repository.pause(campaignId);
    await this.events.emit(new CampaignPaused(campaignId, bounceRate));
  }
}
```

E escute-o com `@OnEvent`, em um método de qualquer provider:

```ts title="src/campaigns/notify-admin.listener.ts"
import { Injectable, inject } from 'viga';
import { OnEvent } from 'viga/events';
import { CampaignPaused } from './campaign-paused.event.ts';

@Injectable()
export class NotifyAdminOnPause {
  private readonly mail = inject(MailService);

  @OnEvent(CampaignPaused)
  async notify(event: CampaignPaused) {
    await this.mail.sendToAdmin(`Campanha ${event.campaignId} pausada: ${event.bounceRate * 100}% de rejeições`);
  }
}
```

Declare o listener nos `providers` do módulo dele, como qualquer provider, e o viga o encontra sozinho. Não é preciso registrá-lo no barramento nem exportá-lo.

:::caution
`@OnEvent` só funciona em providers. Em um controlador ele não é executado, e o viga não avisa.
:::

Um evento ativa apenas os listeners dessa mesma classe, não os das classes pai. Pode haver vários listeners para um evento, que são executados ao mesmo tempo e sem uma ordem garantida. Um método pode escutar vários eventos se você colocar vários `@OnEvent` nele.

## Esperar ou não

`emit` devolve uma promise que termina quando todos os listeners terminaram, e você decide se espera por ela:

```ts
await this.events.emit(new CampaignPaused(id, rate));

void this.events.emit(new CampaignPaused(id, rate));
```

- **Com `await`**, a resposta espera os listeners. É o adequado se o resultado depende deles, e é o que você usará nos testes.
- **Sem `await`**, os listeners continuam em segundo plano e a resposta sai imediatamente. `void` deixa claro que é de propósito.

Nos dois casos, os listeners começam depois que `emit` devolve o controle.

## Erros

A promise de `emit` nunca é rejeitada. Se um listener falhar, o viga registra o erro, os demais continuam e quem emitiu não fica sabendo:

```txt
[Events] The listener NotifyAdminOnPause.notify failed while handling CampaignPaused
```

É de propósito: a falha de um email não deve desfazer a pausa da campanha. E por isso mesmo, os eventos não servem para validar nada. Se um erro precisa interromper a operação, chame o serviço diretamente.

## O contexto

Um listener recebe uma cópia do [contexto da requisição](../../core/request-lifecycle/#o-contexto-da-requisição), então pode usar `CURRENT_USER.get()` ou `CURRENT_TENANT.get()` mesmo que a resposta já tenha saído. O que ele guardar com `set()` não afeta a requisição nem outros listeners.

Se você emitir fora de uma requisição, por exemplo em um script, os listeners recebem um contexto vazio, e as chaves de que precisarem lançarão um erro. Guarde-as antes com [`runInNewContext`](../../core/request-lifecycle/#fora-de-uma-requisição), ou inclua esses dados no evento.

### Transações

Um listener **não** herda a transação de quem emite: `database.db` usa uma conexão normal. Se a herdasse, um listener em segundo plano continuaria a usá-la depois de fechada.

Mesmo assim, emita depois do commit. Um listener não pode ser desfeito: se você emitir dentro da transação e ela for revertida, o email já saiu por algo que nunca aconteceu. O viga mostra um aviso na primeira vez que isso ocorre.

```ts
await this.database.transaction(async () => {
  await this.repository.pause(id);
  await this.audit.record(id);
});

await this.events.emit(new CampaignPaused(id, rate));
```

Se `pause` usa `@Transactional()`, emita a partir do método que o chama, depois que ele terminar.

Para criar suas próprias chaves com esse comportamento, use `createContextKey('nome', { detached: true })`.

## Emita uma única vez

Se duas requisições ou duas instâncias detectarem o mesmo ao mesmo tempo, as duas emitiriam o evento, e o administrador receberia dois emails. Evite isso fazendo com que a mudança de estado decida quem emite. Apenas uma atualização pode ter sucesso:

```ts
async pauseIfActive(campaignId: number, bounceRate: number) {
  const paused = await this.database.db
    .update(campaigns)
    .set({ status: 'paused' })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'active')))
    .returning({ id: campaigns.id });

  if (paused.length > 0) {
    await this.events.emit(new CampaignPaused(campaignId, bounceRate));
  }
}
```

A condição `status = 'active'` faz com que apenas a primeira atualização afete uma linha. O banco de dados resolve a disputa, então também funciona com várias instâncias.

## O que ele não faz

- **Não guarda os eventos.** Se o processo cair, os que estavam em andamento se perdem, e um listener que falha não é repetido.
- **Não sai do processo.** As outras instâncias da sua aplicação não recebem o evento.
- **Não limita os listeners em andamento.** Se você emitir sem `await` mais rápido do que eles terminam, eles se acumulam na memória. Use-o para trabalho breve, e uma fila para o pesado.
- **Não convém emitir em `onModuleInit`.** Só são executados os listeners dos providers já inicializados, e os demais não o recebem.

### Eventos que não podem se perder

Se um evento não pode se perder, como um pagamento que precisa gerar uma fatura, guarde-o na mesma transação da mudança, em uma tabela de saída. É o padrão *outbox*:

```ts
await this.database.transaction(async (tx) => {
  await tx.insert(payments).values(payment);
  await tx.insert(outbox).values({ type: 'PaymentReceived', payload: { paymentId: payment.id } });
});
```

Um processo à parte lê essa tabela periodicamente, faz o trabalho e marca cada linha como processada. Como a linha é salva ou revertida junto com o pagamento, ela não se perde mesmo que o processo caia logo depois. Ela pode ser processada mais de uma vez se falhar no meio, então esse trabalho precisa poder ser repetido sem efeitos duplicados.

## Ao parar

`close()` espera os listeners em andamento, inclusive os dos eventos emitidos por outros listeners, antes de executar os `onModuleDestroy`. Assim, um listener não perde o banco de dados no meio do trabalho.

Ele não espera indefinidamente: depois de 10 segundos, o viga registra um erro e continua fechando. Mude isso com `drainTimeoutMs`:

```ts
EventsModule.forRoot({ drainTimeoutMs: 30_000 });
```

Mantenha-o abaixo do tempo que a sua plataforma dá para terminar, como `terminationGracePeriodSeconds` no Kubernetes. Caso contrário, a plataforma mata o processo antes.

Se você tem seu próprio trabalho pendente, pode fazer o mesmo com o hook [`OnDrain`](../../core/app-lifecycle/#os-hooks-dos-providers).

## Nos testes

Como `emit` espera os listeners, você pode verificar o resultado logo depois:

```ts title="test/campaigns.test.ts"
import { EventBus } from 'viga/events';
import { createTestingApp } from 'viga/testing';

const sent: string[] = [];

const app = await createTestingApp(AppModule, {
  overrides: [{ provide: MailService, useValue: { sendToAdmin: (text: string) => sent.push(text) } }],
});

await app.get(EventBus).emit(new CampaignPaused(1, 0.12));
assert.equal(sent.length, 1);

await app.close();
```
