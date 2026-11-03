---
title: viga/events
description: Separa tus servicios con un bus de eventos en memoria, con eventos tipados, errores aislados y listeners que terminan antes de apagar la app.
sidebar:
  order: 10
---

Cuando pasa algo en tu app, a menudo varias partes tienen que reaccionar. Si `CampaignsService` llama directamente al servicio de email, al de estadísticas y al de auditoría, tiene que conocerlos a todos. Con `viga/events`, solo anuncia lo que pasó, y cada parte interesada se suscribe por su cuenta.

Los eventos viven en la memoria del proceso. Antes de usarlos, lee [lo que no hacen](#lo-que-no-hace).

## Empieza

Importa `EventsModule` en el módulo raíz. Es un módulo global, así que `EventBus` está disponible en toda la app:

```ts title="src/app.module.ts"
import { Module } from 'viga';
import { EventsModule } from 'viga/events';

@Module({
  imports: [EventsModule.forRoot()],
})
export class AppModule {}
```

Un evento es una clase con los datos de lo que pasó. El nombre describe algo que ya ocurrió:

```ts title="src/campaigns/campaign-paused.event.ts"
export class CampaignPaused {
  constructor(
    readonly campaignId: number,
    readonly bounceRate: number,
  ) {}
}
```

Emítelo con `EventBus`:

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

Y escúchalo con `@OnEvent`, en un método de cualquier provider:

```ts title="src/campaigns/notify-admin.listener.ts"
import { Injectable, inject } from 'viga';
import { OnEvent } from 'viga/events';
import { CampaignPaused } from './campaign-paused.event.ts';

@Injectable()
export class NotifyAdminOnPause {
  private readonly mail = inject(MailService);

  @OnEvent(CampaignPaused)
  async notify(event: CampaignPaused) {
    await this.mail.sendToAdmin(`Campaña ${event.campaignId} pausada: ${event.bounceRate * 100}% de rebotes`);
  }
}
```

Declara el listener en los `providers` de su módulo, como cualquier provider, y viga lo encuentra sin más. No hace falta registrarlo en el bus, ni exportarlo.

:::caution
`@OnEvent` solo funciona en providers. En un controlador no se ejecuta, y viga no avisa.
:::

Un evento activa solo los listeners de esa misma clase, no los de sus clases padre. Puede haber varios listeners para un evento, que se ejecutan a la vez y sin un orden garantizado. Un método puede escuchar varios eventos si le pones varios `@OnEvent`.

## Esperar o no

`emit` devuelve una promesa que termina cuando han terminado todos los listeners, y decides si la esperas:

```ts
await this.events.emit(new CampaignPaused(id, rate));

void this.events.emit(new CampaignPaused(id, rate));
```

- **Con `await`**, la respuesta espera a los listeners. Es lo adecuado si el resultado depende de ellos, y es lo que usarás en los tests.
- **Sin `await`**, los listeners siguen en segundo plano y la respuesta sale de inmediato. `void` deja claro que es a propósito.

En los dos casos, los listeners empiezan después de que `emit` devuelva el control.

## Errores

La promesa de `emit` nunca se rechaza. Si un listener falla, viga registra el error, los demás siguen y quien emitió no se entera:

```txt
[Events] The listener NotifyAdminOnPause.notify failed while handling CampaignPaused
```

Es a propósito: que falle un email no debe deshacer la pausa de la campaña. Y por eso mismo, los eventos no sirven para validar nada. Si un error tiene que detener la operación, llama al servicio directamente.

## El contexto

Un listener recibe una copia del [contexto de la petición](../../core/request-lifecycle/#el-contexto-de-la-petición), así que puede usar `CURRENT_USER.get()` o `CURRENT_TENANT.get()` aunque la respuesta ya haya salido. Lo que guarde con `set()` no afecta a la petición ni a otros listeners.

Si emites fuera de una petición, por ejemplo en un script, los listeners reciben un contexto vacío, y las claves que necesiten lanzarán un error. Guárdalas antes con [`runInNewContext`](../../core/request-lifecycle/#fuera-de-una-petición), o incluye esos datos en el evento.

### Transacciones

Un listener **no** hereda la transacción de quien emite: `database.db` usa una conexión normal. Si la heredara, un listener en segundo plano seguiría usándola cuando ya está cerrada.

Aun así, emite después del commit. Un listener no se puede deshacer: si emites dentro de la transacción y esta se revierte, el email ya salió por algo que nunca ocurrió. viga muestra un aviso la primera vez que pasa.

```ts
await this.database.transaction(async () => {
  await this.repository.pause(id);
  await this.audit.record(id);
});

await this.events.emit(new CampaignPaused(id, rate));
```

Si `pause` usa `@Transactional()`, emite desde el método que lo llama, una vez que ha terminado.

Para crear tus propias claves con este comportamiento, usa `createContextKey('nombre', { detached: true })`.

## Emite una sola vez

Si dos peticiones o dos instancias detectan lo mismo a la vez, las dos emitirían el evento, y el administrador recibiría dos emails. Evítalo haciendo que el cambio de estado decida quién emite. Una sola actualización puede tener éxito:

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

La condición `status = 'active'` hace que solo la primera actualización afecte a una fila. La base de datos resuelve la carrera, así que funciona también con varias instancias.

## Lo que no hace

- **No guarda los eventos.** Si el proceso se cae, se pierden los que estaban en curso, y un listener que falla no se reintenta.
- **No sale del proceso.** Las demás instancias de tu app no reciben el evento.
- **No limita los listeners en curso.** Si emites sin `await` más rápido de lo que terminan, se acumulan en memoria. Úsalo para trabajo breve, y una cola para el pesado.
- **No conviene emitir en `onModuleInit`.** Solo se ejecutan los listeners de los providers ya inicializados, y los demás no lo reciben.

### Eventos que no se pueden perder

Si un evento no se puede perder, como un cobro que tiene que generar una factura, guárdalo en la misma transacción que el cambio, en una tabla de salida. Es el patrón *outbox*:

```ts
await this.database.transaction(async (tx) => {
  await tx.insert(payments).values(payment);
  await tx.insert(outbox).values({ type: 'PaymentReceived', payload: { paymentId: payment.id } });
});
```

Un proceso aparte lee esa tabla periódicamente, hace el trabajo y marca cada fila como procesada. Como la fila se guarda o se revierte junto con el cobro, no se pierde aunque el proceso se caiga justo después. Puede procesarse más de una vez si falla a mitad, así que ese trabajo tiene que poder repetirse sin efectos duplicados.

## Al detenerse

`close()` espera a los listeners en curso, también a los de los eventos que emitan otros listeners, antes de ejecutar los `onModuleDestroy`. Así, un listener no pierde la base de datos a mitad de su trabajo.

No espera indefinidamente: tras 10 segundos, viga registra un error y sigue cerrando. Cámbialo con `drainTimeoutMs`:

```ts
EventsModule.forRoot({ drainTimeoutMs: 30_000 });
```

Mantenlo por debajo del tiempo que tu plataforma da para terminar, como `terminationGracePeriodSeconds` en Kubernetes. Si no, la plataforma mata el proceso antes.

Si tienes tu propio trabajo pendiente, puedes hacer lo mismo con el hook [`OnDrain`](../../core/app-lifecycle/#los-hooks-de-los-providers).

## En los tests

Como `emit` espera a los listeners, puedes comprobar el resultado justo después:

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
