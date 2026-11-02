---
title: '@vigajs/core/events'
description: Decouple your services with an in-memory event bus, with typed events, isolated errors and listeners that finish before the app shuts down.
sidebar:
  order: 10
---

When something happens in your app, several parts often have to react. If `CampaignsService` directly calls the email, statistics and audit services, it has to know all of them. With `@vigajs/core/events`, it only announces what happened, and each interested part subscribes on its own.

Events live in the process's memory. Before using them, read [what they don't do](#what-it-doesnt-do).

## Get started

Import `EventsModule` in the root module. It's a global module, so `EventBus` is available throughout the app:

```ts title="src/app.module.ts"
import { Module } from '@vigajs/core';
import { EventsModule } from '@vigajs/core/events';

@Module({
  imports: [EventsModule.forRoot()],
})
export class AppModule {}
```

An event is a class with the data of what happened. Its name describes something that already occurred:

```ts title="src/campaigns/campaign-paused.event.ts"
export class CampaignPaused {
  constructor(
    readonly campaignId: number,
    readonly bounceRate: number,
  ) {}
}
```

Emit it with `EventBus`:

```ts title="src/campaigns/campaigns.service.ts"
import { Injectable, inject } from '@vigajs/core';
import { EventBus } from '@vigajs/core/events';
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

And listen to it with `@OnEvent`, on a method of any provider:

```ts title="src/campaigns/notify-admin.listener.ts"
import { Injectable, inject } from '@vigajs/core';
import { OnEvent } from '@vigajs/core/events';
import { CampaignPaused } from './campaign-paused.event.ts';

@Injectable()
export class NotifyAdminOnPause {
  private readonly mail = inject(MailService);

  @OnEvent(CampaignPaused)
  async notify(event: CampaignPaused) {
    await this.mail.sendToAdmin(`Campaign ${event.campaignId} paused: ${event.bounceRate * 100}% bounces`);
  }
}
```

Declare the listener in its module's `providers`, like any provider, and viga finds it on its own. There's no need to register it on the bus or export it.

:::caution
`@OnEvent` only works in providers. In a controller it doesn't run, and viga doesn't warn you.
:::

An event only triggers the listeners of that same class, not those of its parent classes. An event can have several listeners, which run at the same time and in no guaranteed order. A method can listen to several events if you give it several `@OnEvent` decorators.

## To wait or not

`emit` returns a promise that finishes when all the listeners have finished, and you decide whether to wait for it:

```ts
await this.events.emit(new CampaignPaused(id, rate));

void this.events.emit(new CampaignPaused(id, rate));
```

- **With `await`**, the response waits for the listeners. It's the right choice if the result depends on them, and it's what you'll use in tests.
- **Without `await`**, the listeners continue in the background and the response goes out immediately. `void` makes it clear that it's on purpose.

In both cases, the listeners start after `emit` returns control.

## Errors

The promise from `emit` never rejects. If a listener fails, viga logs the error, the others carry on and the emitter doesn't find out:

```txt
[Events] The listener NotifyAdminOnPause.notify failed while handling CampaignPaused
```

That's on purpose: a failed email shouldn't undo pausing the campaign. For the same reason, events aren't for validating anything. If an error has to stop the operation, call the service directly.

## The context

A listener receives a copy of the [request context](../../core/request-lifecycle/#the-request-context), so it can use `CURRENT_USER.get()` or `CURRENT_TENANT.get()` even if the response has already gone out. What it stores with `set()` doesn't affect the request or other listeners.

If you emit outside a request, for example in a script, the listeners receive an empty context, and the keys they need will throw an error. Store them first with [`runInNewContext`](../../core/request-lifecycle/#outside-a-request), or include that data in the event.

### Transactions

A listener does **not** inherit the emitter's transaction: `database.db` uses a normal connection. If it inherited it, a background listener would keep using it after it had closed.

Even so, emit after the commit. A listener can't be undone: if you emit inside the transaction and it rolls back, the email has already gone out for something that never happened. viga shows a warning the first time this happens.

```ts
await this.database.transaction(async () => {
  await this.repository.pause(id);
  await this.audit.record(id);
});

await this.events.emit(new CampaignPaused(id, rate));
```

If `pause` uses `@Transactional()`, emit from the method that calls it, once it has finished.

To create your own keys with this behavior, use `createContextKey('name', { detached: true })`.

## Emit only once

If two requests or two instances detect the same thing at once, both would emit the event, and the admin would receive two emails. Avoid it by letting the state change decide who emits. Only one update can succeed:

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

The `status = 'active'` condition means only the first update affects a row. The database resolves the race, so it also works with several instances.

## What it doesn't do

- **It doesn't store events.** If the process crashes, the ones in progress are lost, and a listener that fails isn't retried.
- **It doesn't leave the process.** Your app's other instances don't receive the event.
- **It doesn't limit running listeners.** If you emit without `await` faster than they finish, they pile up in memory. Use it for brief work, and a queue for heavy work.
- **Avoid emitting in `onModuleInit`.** Only the listeners of providers already initialized run, and the others don't receive it.

### Events that can't be lost

If an event can't be lost, like a payment that has to generate an invoice, store it in the same transaction as the change, in an outbox table. This is the *outbox* pattern:

```ts
await this.database.transaction(async (tx) => {
  await tx.insert(payments).values(payment);
  await tx.insert(outbox).values({ type: 'PaymentReceived', payload: { paymentId: payment.id } });
});
```

A separate process reads that table periodically, does the work and marks each row as processed. Since the row is saved or rolled back together with the payment, it isn't lost even if the process crashes right after. It can be processed more than once if it fails halfway, so that work has to be repeatable without duplicate effects.

## On shutdown

`close()` waits for running listeners, including those of events emitted by other listeners, before running the `onModuleDestroy` hooks. That way, a listener doesn't lose the database halfway through its work.

It doesn't wait indefinitely: after 10 seconds, viga logs an error and carries on closing. Change it with `drainTimeoutMs`:

```ts
EventsModule.forRoot({ drainTimeoutMs: 30_000 });
```

Keep it below the time your platform gives to finish, like `terminationGracePeriodSeconds` in Kubernetes. Otherwise, the platform kills the process first.

If you have your own pending work, you can do the same with the [`OnDrain`](../../core/app-lifecycle/#provider-hooks) hook.

## In tests

Since `emit` waits for the listeners, you can check the result right after:

```ts title="test/campaigns.test.ts"
import { EventBus } from '@vigajs/core/events';
import { createTestingApp } from '@vigajs/core/testing';

const sent: string[] = [];

const app = await createTestingApp(AppModule, {
  overrides: [{ provide: MailService, useValue: { sendToAdmin: (text: string) => sent.push(text) } }],
});

await app.get(EventBus).emit(new CampaignPaused(1, 0.12));
assert.equal(sent.length, 1);

await app.close();
```
