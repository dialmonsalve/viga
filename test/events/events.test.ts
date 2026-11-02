import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  Controller,
  Get,
  Injectable,
  Module,
  Public,
  createApp,
  createContextKey,
  inject,
  runInNewContext,
  silentLogger,
  type AnyConstructor,
  type Logger,
  type OnDrain,
  type OnModuleDestroy,
  type OnModuleInit,
} from '../../src/index.ts';
import { EventBus, EventsModule, OnEvent, type EventsOptions } from '../../src/events/index.ts';
import { createTestingApp } from '../../src/testing/index.ts';

class OrderPaid {
  constructor(readonly id: number) {}
}
class OrderRefunded {
  constructor(readonly id: number) {}
}
class SpecialOrderPaid extends OrderPaid {}

function capturingLogger() {
  const errors: unknown[][] = [];
  const warnings: unknown[][] = [];
  const logger: Logger = {
    ...silentLogger,
    error: (...args: unknown[]) => errors.push(args),
    warn: (...args: unknown[]) => warnings.push(args),
  };
  return { errors, warnings, logger };
}

async function start(providers: AnyConstructor[], { logger, options }: { logger?: Logger; options?: EventsOptions } = {}) {
  @Module({ imports: [EventsModule.forRoot(options)], providers })
  class AppModule {}

  const app = createApp({ rootModule: AppModule, logger: logger ?? silentLogger });
  await app.init();
  return app;
}

describe('viga/events', () => {
  it('entrega el evento a todos sus listeners y solo a los suyos', async () => {
    const seen: string[] = [];

    @Injectable()
    class Mail {
      @OnEvent(OrderPaid)
      paid(event: OrderPaid) {
        seen.push(`mail:paid:${event.id}`);
      }

      @OnEvent(OrderRefunded)
      refunded(event: OrderRefunded) {
        seen.push(`mail:refunded:${event.id}`);
      }
    }

    @Injectable()
    class Stats {
      @OnEvent(OrderPaid)
      async paid(event: OrderPaid) {
        await sleep(1);
        seen.push(`stats:paid:${event.id}`);
      }
    }

    const app = await start([Mail, Stats]);
    await app.get(EventBus).emit(new OrderPaid(1));

    assert.deepEqual(seen.sort(), ['mail:paid:1', 'stats:paid:1']);
    await app.close();
  });

  it('un método puede escuchar varios eventos y usa sus dependencias', async () => {
    const seen: number[] = [];

    @Injectable()
    class Store {
      add(id: number) {
        seen.push(id);
      }
    }

    @Injectable()
    class Listener {
      private readonly store = inject(Store);

      @OnEvent(OrderPaid)
      @OnEvent(OrderRefunded)
      handle(event: OrderPaid | OrderRefunded) {
        this.store.add(event.id);
      }
    }

    const app = await start([Store, Listener]);
    await app.get(EventBus).emit(new OrderPaid(1));
    await app.get(EventBus).emit(new OrderRefunded(2));

    assert.deepEqual(seen, [1, 2]);
    await app.close();
  });

  it('no entrega a los listeners de la clase padre', async () => {
    let calls = 0;

    @Injectable()
    class Listener {
      @OnEvent(OrderPaid)
      handle() {
        calls++;
      }
    }

    const app = await start([Listener]);
    await app.get(EventBus).emit(new SpecialOrderPaid(1));

    assert.equal(calls, 0);
    await app.close();
  });

  it('una subclase de un provider hereda sus listeners', async () => {
    const seen: string[] = [];

    class Base {
      @OnEvent(OrderPaid)
      handle() {
        seen.push(this.constructor.name);
      }
    }

    @Injectable()
    class Child extends Base {}

    const app = await start([Child]);
    await app.get(EventBus).emit(new OrderPaid(1));

    assert.deepEqual(seen, ['Child']);
    await app.close();
  });

  it('emit sin listeners termina sin hacer nada', async () => {
    const app = await start([]);
    await app.get(EventBus).emit(new OrderPaid(1));
    await app.close();
  });

  it('los listeners empiezan después de emit', async () => {
    const order: string[] = [];

    @Injectable()
    class Listener {
      @OnEvent(OrderPaid)
      handle() {
        order.push('listener');
      }
    }

    const app = await start([Listener]);
    const running = app.get(EventBus).emit(new OrderPaid(1));
    order.push('after emit');
    await running;

    assert.deepEqual(order, ['after emit', 'listener']);
    await app.close();
  });

  it('un listener que falla se registra, no afecta a los demás y emit no se rechaza', async () => {
    const { errors, logger } = capturingLogger();
    let reached = false;

    @Injectable()
    class Sync {
      @OnEvent(OrderPaid)
      handle() {
        throw new Error('sync boom');
      }
    }

    @Injectable()
    class Async {
      @OnEvent(OrderPaid)
      async handle() {
        throw new Error('async boom');
      }
    }

    @Injectable()
    class Healthy {
      @OnEvent(OrderPaid)
      handle() {
        reached = true;
      }
    }

    const app = await start([Sync, Async, Healthy], { logger });
    await app.get(EventBus).emit(new OrderPaid(1));

    assert.equal(reached, true);
    assert.equal(errors.length, 2);
    assert.match(String(errors[0]?.[0]), /Sync\.handle.*OrderPaid/);
    assert.match(String(errors[1]?.[0]), /Async\.handle.*OrderPaid/);
    await app.close();
  });

  describe('contexto', () => {
    const TENANT = createContextKey<string>('test.tenant');
    const NOTE = createContextKey<string>('test.note');
    const TRANSACTION = createContextKey<string>('test.transaction', { detached: true });

    it('los listeners heredan el contexto salvo las claves detached', async () => {
      const seen: unknown[] = [];

      @Injectable()
      class Listener {
        @OnEvent(OrderPaid)
        handle() {
          seen.push(TENANT.find(), TRANSACTION.find());
        }
      }

      const app = await start([Listener]);
      await runInNewContext(() =>
        TENANT.run('acme', () => TRANSACTION.run('tx', () => app.get(EventBus).emit(new OrderPaid(1))))
      );

      assert.deepEqual(seen, ['acme', undefined]);
      await app.close();
    });

    it('sin await, el contexto sigue disponible aunque termine quien emitió', async () => {
      const seen: unknown[] = [];

      @Injectable()
      class Listener {
        @OnEvent(OrderPaid)
        async handle() {
          await sleep(5);
          seen.push(TENANT.find());
        }
      }

      const app = await start([Listener]);
      runInNewContext(() => TENANT.run('acme', () => void app.get(EventBus).emit(new OrderPaid(1))));
      await app.close();

      assert.deepEqual(seen, ['acme']);
    });

    it('lo que un listener guarda en el contexto no afecta a quien emite ni a otros listeners', async () => {
      const seen: unknown[] = [];

      @Injectable()
      class Writer {
        @OnEvent(OrderPaid)
        handle() {
          NOTE.set('written');
        }
      }

      @Injectable()
      class Reader {
        @OnEvent(OrderPaid)
        async handle() {
          await sleep(1);
          seen.push(NOTE.find());
        }
      }

      const app = await start([Writer, Reader]);
      await runInNewContext(async () => {
        await app.get(EventBus).emit(new OrderPaid(1));
        seen.push(NOTE.find());
      });

      assert.deepEqual(seen, [undefined, undefined]);
      await app.close();
    });

    it('fuera de una petición, los listeners pueden guardar valores en el contexto', async () => {
      const seen: unknown[] = [];

      @Injectable()
      class Listener {
        @OnEvent(OrderPaid)
        handle() {
          NOTE.set('ok');
          seen.push(NOTE.get());
        }
      }

      const app = await start([Listener]);
      await app.get(EventBus).emit(new OrderPaid(1));

      assert.deepEqual(seen, ['ok']);
      await app.close();
    });

    it('avisa una vez si se emite con una clave detached activa', async () => {
      const { warnings, logger } = capturingLogger();
      const app = await start([], { logger });
      const bus = app.get(EventBus);

      await bus.emit(new OrderPaid(1));
      assert.equal(warnings.length, 0);

      await runInNewContext(() =>
        TRANSACTION.run('tx', async () => {
          await bus.emit(new OrderPaid(1));
          await bus.emit(new OrderPaid(2));
        })
      );

      assert.equal(warnings.length, 1);
      assert.match(String(warnings[0]?.[0]), /OrderPaid.*transaction/);
      await app.close();
    });
  });

  describe('al detenerse', () => {
    it('espera a los listeners en curso antes de los onModuleDestroy', async () => {
      const order: string[] = [];

      @Injectable()
      class Database implements OnModuleDestroy {
        onModuleDestroy() {
          order.push('database closed');
        }
      }

      @Injectable()
      class Listener {
        private readonly database = inject(Database);

        @OnEvent(OrderPaid)
        async handle() {
          assert.ok(this.database);
          await sleep(20);
          order.push('listener finished');
        }
      }

      for (const providers of [
        [Database, Listener],
        [Listener, Database],
      ]) {
        order.length = 0;
        const app = await start(providers);
        void app.get(EventBus).emit(new OrderPaid(1));
        await app.close();
        assert.deepEqual(order, ['listener finished', 'database closed']);
      }
    });

    it('espera también a los eventos que emite un listener', async () => {
      const order: string[] = [];

      @Injectable()
      class Chained {
        private readonly bus = inject(EventBus);

        @OnEvent(OrderPaid)
        async first() {
          await sleep(5);
          void this.bus.emit(new OrderRefunded(1));
        }

        @OnEvent(OrderRefunded)
        async second() {
          await sleep(15);
          order.push('second finished');
        }
      }

      const app = await start([Chained]);
      void app.get(EventBus).emit(new OrderPaid(1));
      await app.close();

      assert.deepEqual(order, ['second finished']);
    });

    it('no espera más de drainTimeoutMs y lo registra', async () => {
      const { errors, logger } = capturingLogger();

      @Injectable()
      class Stuck {
        @OnEvent(OrderPaid)
        handle() {
          return new Promise(() => {});
        }
      }

      const app = await start([Stuck], { logger, options: { drainTimeoutMs: 20 } });
      void app.get(EventBus).emit(new OrderPaid(1));

      const startedAt = Date.now();
      await app.close();

      assert.ok(Date.now() - startedAt < 1_000);
      assert.match(String(errors[0]?.[0]), /1 event listeners.*20 ms/);
    });

    it('los eventos de una petición terminan antes de cerrar, sin await en el controlador', async () => {
      const order: string[] = [];

      @Injectable()
      class Listener {
        @OnEvent(OrderPaid)
        async handle() {
          await sleep(20);
          order.push('listener finished');
        }
      }

      @Injectable()
      class Database implements OnModuleDestroy {
        onModuleDestroy() {
          order.push('database closed');
        }
      }

      @Public()
      @Controller('/orders')
      class OrdersController {
        private readonly bus = inject(EventBus);

        @Get()
        create() {
          void this.bus.emit(new OrderPaid(1));
          return { ok: true };
        }
      }

      @Module({ imports: [EventsModule.forRoot()], controllers: [OrdersController], providers: [Listener, Database] })
      class AppModule {}

      const app = await createTestingApp(AppModule);
      assert.equal((await app.request('/orders')).status, 200);
      await app.close();

      assert.deepEqual(order, ['listener finished', 'database closed']);
    });
  });

  describe('OnDrain', () => {
    it('corre después de las peticiones y antes de onModuleDestroy, también sin servidor', async () => {
      const order: string[] = [];

      @Injectable()
      class Worker implements OnDrain, OnModuleDestroy {
        onDrain() {
          order.push('drain');
        }

        onModuleDestroy() {
          order.push('destroy');
        }
      }

      @Module({ providers: [Worker] })
      class AppModule {}

      const app = createApp({ rootModule: AppModule, logger: silentLogger });
      await app.init();
      await app.close();

      assert.deepEqual(order, ['drain', 'destroy']);
    });

    it('si falla, se registra y se ejecutan igual los onModuleDestroy', async () => {
      const { errors, logger } = capturingLogger();
      let destroyed = false;

      @Injectable()
      class Worker implements OnDrain, OnModuleDestroy {
        onDrain() {
          throw new Error('boom');
        }

        onModuleDestroy() {
          destroyed = true;
        }
      }

      @Module({ providers: [Worker] })
      class AppModule {}

      const app = createApp({ rootModule: AppModule, logger });
      await app.init();
      await app.close();

      assert.equal(destroyed, true);
      assert.equal(errors.length, 1);
    });
  });

  it('un provider puede emitir en onModuleInit, y solo reciben los ya inicializados', async () => {
    const seen: string[] = [];

    @Injectable()
    class Before {
      @OnEvent(OrderPaid)
      handle() {
        seen.push('before');
      }
    }

    @Injectable()
    class Emitter implements OnModuleInit {
      private readonly bus = inject(EventBus);
      private readonly before = inject(Before);

      async onModuleInit() {
        assert.ok(this.before);
        await this.bus.emit(new OrderPaid(1));
      }
    }

    @Injectable()
    class After {
      private readonly emitter = inject(Emitter);

      @OnEvent(OrderPaid)
      handle() {
        assert.ok(this.emitter);
        seen.push('after');
      }
    }

    const app = await start([Before, Emitter, After]);

    assert.deepEqual(seen, ['before']);
    await app.get(EventBus).emit(new OrderPaid(2));
    assert.deepEqual(seen.sort(), ['after', 'before', 'before']);
    await app.close();
  });

  it('rechaza opciones inválidas al arrancar', async () => {
    await assert.rejects(start([], { options: { drainTimeoutMs: 0 } }), /drainTimeoutMs/);
    await assert.rejects(start([], { options: { drainTimeoutMs: 1.5 } }), /drainTimeoutMs/);
  });

  it('@OnEvent rechaza métodos estáticos', () => {
    assert.throws(() => {
      class Invalid {
        @OnEvent(OrderPaid)
        static handle() {}
      }
      return Invalid;
    }, /public instance methods/);
  });
});
