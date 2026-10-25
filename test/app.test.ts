import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import {
  Controller,
  Get,
  Injectable,
  InjectionToken,
  LOGGER,
  Module,
  Patch,
  Public,
  createApp,
  inject,
  silentLogger,
  type OnModuleDestroy,
  type OnModuleInit,
  type OnServerClose,
  type OnServerListen,
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

  describe('avisos de rutas privadas al arrancar', () => {
    @Controller('status')
    class StatusController {
      @Public()
      @Get()
      status() {
        return 'ok';
      }

      @Get('secret')
      secret() {
        return 'secret';
      }

      @Patch('secret')
      update() {}
    }

    @Module({ controllers: [StatusController] })
    class StatusModule {}

    @Public()
    @Controller('open')
    class OpenController {
      @Get()
      open() {
        return 'open';
      }
    }

    @Module({ controllers: [OpenController] })
    class OpenModule {}

    const boot = async (rootModule: typeof StatusModule, guard?: () => boolean) => {
      const warnings: string[] = [];
      const debug: string[] = [];
      const app = createApp({
        rootModule,
        globalPrefix: '/api',
        requireValidation: false,
        logger: {
          ...silentLogger,
          warn: (message) => warnings.push(message),
          debug: (message) => debug.push(message),
        },
      });
      if (guard) app.useAuthGuard(guard);
      await app.init();
      await app.close();
      return { warnings, debug };
    };

    it('avisa si hay rutas privadas y ningún guard, y dice cuántas', async () => {
      const { warnings } = await boot(StatusModule);

      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /No auth guard is configured, so the 2 private routes will respond 401/);
    });

    it('no avisa si hay guard o si todas las rutas son públicas', async () => {
      assert.deepEqual((await boot(StatusModule, () => true)).warnings, []);
      assert.deepEqual((await boot(OpenModule)).warnings, []);
    });

    it('lista las rutas públicas con su método y la ruta completa en el log de debug', async () => {
      const { debug } = await boot(StatusModule, () => true);

      assert.deepEqual(debug, ['[App] Public routes: GET /api/status']);
    });
  });

  it('si un onServerClose falla, lo registra y sigue cerrando', async () => {
    const log: string[] = [];
    const errors: unknown[] = [];

    @Injectable()
    class Broken implements OnServerClose, OnModuleDestroy {
      onServerClose() {
        throw new Error('no cierra');
      }
      onModuleDestroy() {
        log.push('destroy');
      }
    }

    @Module({ providers: [Broken] })
    class BrokenModule {}

    const app = createApp({
      rootModule: BrokenModule,
      logger: { ...silentLogger, error: (message, error) => errors.push([message, error]) },
    });
    await app.listen(0, '127.0.0.1');
    await app.close();

    assert.deepEqual(log, ['destroy']);
    assert.equal(errors.length, 1);
    assert.match(String((errors[0] as [string])[0]), /failed while the server was closing/);
  });

  it('llama a onServerListen con el servidor y a onServerClose antes de onModuleDestroy', async () => {
    const log: string[] = [];

    @Injectable()
    class Socket implements OnServerListen, OnServerClose, OnModuleDestroy {
      onServerListen(server: Server) {
        log.push(`listen:${server.listening}`);
      }
      onServerClose() {
        log.push('server-close');
      }
      onModuleDestroy() {
        log.push('destroy');
      }
    }

    @Module({ providers: [Socket] })
    class SocketModule {}

    const app = createApp({ rootModule: SocketModule, logger: silentLogger });
    await app.listen(0, '127.0.0.1');
    await app.close();

    assert.deepEqual(log, ['listen:false', 'server-close', 'destroy']);
  });

  describe('enableShutdownHooks()', () => {
    const fixture = fileURLToPath(new URL('./fixtures/shutdown-app.ts', import.meta.url));

    const runAndSignal = async (signal: NodeJS.Signals, args: string[] = []) => {
      const child = spawn(process.execPath, ['--import', 'tsx', fixture, ...args], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      let output = '';
      let signaled = false;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        output += chunk;
        if (!signaled && output.includes('ready\n')) {
          signaled = true;
          child.kill(signal);
        }
      });
      const [code] = (await once(child, 'exit')) as [number | null];
      return { code, output };
    };

    it('cierra la app y termina con 128 + la señal aunque el event loop siga vivo', async () => {
      const term = await runAndSignal('SIGTERM');
      const int = await runAndSignal('SIGINT');

      assert.equal(term.code, 143);
      assert.match(term.output, /destroyed/);
      assert.equal(int.code, 130);
      assert.match(int.output, /destroyed/);
    });

    it('termina con código 1 si el cierre falla', async () => {
      const { code, output } = await runAndSignal('SIGTERM', ['--fail-on-destroy']);

      assert.equal(code, 1);
      assert.match(output, /destroyed/);
    });
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
