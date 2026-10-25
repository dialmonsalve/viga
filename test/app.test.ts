import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import {
  Controller,
  Get,
  Injectable,
  InjectionToken,
  LOGGER,
  Module,
  Patch,
  createApp,
  inject,
  silentLogger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '../src/index.ts';
import { startTestServer, type TestServer } from './helpers/http.ts';

const events: string[] = [];

@Injectable()
class Database implements OnModuleInit, OnModuleDestroy {
  connected = false;

  async onModuleInit() {
    await Promise.resolve();
    this.connected = true;
    events.push('db:init');
  }

  onModuleDestroy() {
    events.push('db:destroy');
  }
}

@Module({ providers: [Database], exports: [Database] })
class DatabaseModule {}

@Injectable()
class Reports implements OnModuleInit, OnModuleDestroy {
  private readonly db = inject(Database);
  readonly logger = inject(LOGGER);

  onModuleInit() {
    events.push(`reports:init (db conectada: ${this.db.connected})`);
  }

  onModuleDestroy() {
    events.push('reports:destroy');
  }
}

@Controller('/reports')
class ReportsController {
  private readonly reports = inject(Reports);

  @Get()
  list() {
    return { usesPlatformLogger: this.reports.logger === silentLogger };
  }
}

@Module({ imports: [DatabaseModule], controllers: [ReportsController], providers: [Reports] })
class ReportsModule {}

describe('App', () => {
  describe('ciclo de vida', () => {
    it('inicia los providers en orden de dependencias y los cierra al revés', async () => {
      events.length = 0;
      const app = createApp({ rootModule: ReportsModule, logger: silentLogger });

      await app.init();
      assert.deepEqual(events, ['db:init', 'reports:init (db conectada: true)']);

      await app.close();
      assert.deepEqual(events.slice(2), ['reports:destroy', 'db:destroy']);
    });

    it('close() es idempotente', async () => {
      events.length = 0;
      const app = createApp({ rootModule: ReportsModule, logger: silentLogger });
      await app.init();

      await Promise.all([app.close(), app.close()]);

      assert.equal(events.filter((event) => event === 'db:destroy').length, 1);
    });

    it('get() resuelve providers del módulo raíz después de init()', async () => {
      const app = createApp({ rootModule: ReportsModule, logger: silentLogger });

      assert.throws(() => app.get(Reports), /after init/);
      await app.init();
      assert.ok(app.get(Reports) instanceof Reports);
      await app.close();
    });

    it('intenta cerrar todos los providers aunque uno falle', async () => {
      const closed: string[] = [];

      @Injectable()
      class Broken {
        onModuleDestroy() {
          throw new Error('no cierra');
        }
      }

      @Injectable()
      class Healthy {
        onModuleDestroy() {
          closed.push('healthy');
        }
      }

      @Module({ providers: [Healthy, Broken] })
      class FragileModule {}

      const app = createApp({ rootModule: FragileModule, logger: silentLogger });
      await app.init();

      await assert.rejects(app.close(), AggregateError);
      assert.deepEqual(closed, ['healthy']);
    });

    it('si un onModuleInit falla, close() cierra solo los providers ya iniciados', async () => {
      const log: string[] = [];

      @Injectable()
      class Pool {
        onModuleInit() {
          log.push('pool:init');
        }
        onModuleDestroy() {
          log.push('pool:destroy');
        }
      }

      @Injectable()
      class Cache {
        onModuleInit() {
          throw new Error('redis caído');
        }
        onModuleDestroy() {
          log.push('cache:destroy');
        }
      }

      @Injectable()
      class Mailer {
        onModuleDestroy() {
          log.push('mailer:destroy');
        }
      }

      @Module({ providers: [Pool, Cache, Mailer] })
      class InfraModule {}

      const app = createApp({ rootModule: InfraModule, logger: silentLogger });

      await assert.rejects(app.init(), /redis caído/);
      await app.close();

      assert.deepEqual(log, ['pool:init', 'pool:destroy']);
    });

    it('si el arranque falla después de los onModuleInit, close() cierra todos los providers', async () => {
      const log: string[] = [];

      @Injectable()
      class Pool {
        onModuleDestroy() {
          log.push('pool:destroy');
        }
      }

      @Controller('loose')
      class LooseController {
        @Patch(':id')
        update() {}
      }

      @Module({ providers: [Pool], controllers: [LooseController] })
      class LooseModule {}

      const app = createApp({
        rootModule: LooseModule,
        logger: silentLogger,
        requireValidation: true,
      });

      await assert.rejects(app.init(), /has no @Validate/);
      await app.close();

      assert.deepEqual(log, ['pool:destroy']);
    });
  });

  describe('configuración HTTP', () => {
    let server: TestServer;
    const order: string[] = [];

    before(async () => {
      server = await startTestServer(ReportsModule, {
        globalPrefix: 'api/v1/',
        configure: (app) =>
          app.useAuthGuard(() => true).use(
            (_req, res, next) => {
              order.push('primero');
              res.setHeader('x-powered-by-app', 'viga');
              next();
            },
            (_req, _res, next) => {
              order.push('segundo');
              next();
            }
          ),
      });
    });

    after(() => server.close());

    it('monta las rutas bajo el prefijo global', async () => {
      assert.equal((await server.request('/api/v1/reports')).status, 200);
      assert.equal((await server.request('/reports')).status, 404);
    });

    it('ejecuta los middlewares de la app en orden antes de las rutas', async () => {
      order.length = 0;
      const { headers } = await server.request('/api/v1/reports');

      assert.deepEqual(order, ['primero', 'segundo']);
      assert.equal(headers.get('x-powered-by-app'), 'viga');
    });

    it('ofrece el logger configurado como provider de plataforma', async () => {
      const { body } = await server.request('/api/v1/reports');

      assert.deepEqual(body, { usesPlatformLogger: true });
    });

    it('no permite cambiar la configuración después de arrancar', () => {
      assert.throws(() => server.app.use((_req, _res, next) => next()), /before init/);
      assert.throws(() => server.app.setGlobalPrefix('/otra'), /before init/);
    });
  });

  it('no deja abierto el servidor después de close()', async () => {
    const TOKEN = new InjectionToken<number>('TOKEN');

    @Module({ providers: [{ provide: TOKEN, useValue: 1 }] })
    class EmptyModule {}

    const server = await startTestServer(EmptyModule);
    await server.close();

    await assert.rejects(server.request('/'));
  });

  it('listen() sin puerto escucha en el 3000', async () => {
    @Module({})
    class EmptyModule {}

    const app = createApp({ rootModule: EmptyModule, logger: silentLogger });
    const server = await app.listen(undefined, '127.0.0.1');

    try {
      assert.equal((server.address() as AddressInfo).port, 3000);
    } finally {
      await app.close();
    }
  });
});
