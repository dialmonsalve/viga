import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import {
  Controller,
  Get,
  Injectable,
  Module,
  inject,
  silentLogger,
  type Logger,
} from '../../src/index.ts';
import { HealthModule, HealthService, type HealthOptions, type HealthRoutes } from '../../src/health/index.ts';
import { createTestingApp, type TestingAppOptions } from '../../src/testing/index.ts';

function capturingLogger() {
  const errors: unknown[][] = [];
  const logger: Logger = { ...silentLogger, error: (...args: unknown[]) => errors.push(args) };
  return { errors, logger };
}

async function start(
  options?: HealthOptions | (() => HealthOptions),
  routes?: HealthRoutes,
  appOptions?: TestingAppOptions
) {
  @Module({ imports: [HealthModule.forRoot(options, routes)] })
  class AppModule {}

  return createTestingApp(AppModule, appOptions);
}

describe('viga/health', () => {
  it('/health responde 200 sin ejecutar las comprobaciones', async () => {
    const check = mock.fn(() => {
      throw new Error('down');
    });
    const app = await start({ checks: { database: check } });

    const response = await app.request('/health');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ok' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(check.mock.callCount(), 0);
    await app.close();
  });

  it('/ready responde 200 sin comprobaciones o si todas pasan', async () => {
    const empty = await start();
    assert.deepEqual((await empty.request('/ready')).body, { status: 'ok' });
    await empty.close();

    const app = await start({ checks: { sync: () => undefined, asynchronous: async () => 'pong' } });
    const response = await app.request('/ready');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ok' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await app.close();
  });

  for (const [name, check] of [
    ['lanza un error', () => { throw new Error('secret host 10.0.0.5'); }],
    ['rechaza', () => Promise.reject(new Error('secret host 10.0.0.5'))],
    ['devuelve false', () => false],
    ['devuelve una promesa con false', async () => false],
  ] as const) {
    it(`/ready responde 503 sin detalles si una comprobación ${name}, y lo registra`, async () => {
      const { errors, logger } = capturingLogger();
      const app = await start({ checks: { ok: () => true, database: check } }, undefined, { logger });

      const response = await app.request('/ready');

      assert.equal(response.status, 503);
      assert.deepEqual(response.body, { status: 'unavailable' });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(errors.length, 1);
      assert.match(String(errors[0]?.[0]), /database/);
      await app.close();
    });
  }

  it('una comprobación que no termina agota su tiempo', async () => {
    const { errors, logger } = capturingLogger();
    const app = await start(
      { checks: { slow: () => new Promise(() => {}) }, timeoutMs: 20 },
      undefined,
      { logger }
    );

    assert.equal((await app.request('/ready')).status, 503);
    assert.match(String(errors[0]?.[1]), /20 ms/);
    await app.close();
  });

  it('las peticiones simultáneas comparten una sola ejecución', async () => {
    const check = mock.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const app = await start({ checks: { database: check }, cacheMs: 0 });

    const responses = await Promise.all([app.request('/ready'), app.request('/ready'), app.request('/ready')]);

    assert.deepEqual(responses.map(({ status }) => status), [200, 200, 200]);
    assert.equal(check.mock.callCount(), 1);
    await app.close();
  });

  it('guarda el resultado durante cacheMs y después vuelve a comprobar', async () => {
    let healthy = false;
    const check = mock.fn(() => healthy);
    const app = await start({ checks: { database: check }, cacheMs: 50 });

    assert.equal((await app.request('/ready')).status, 503);
    healthy = true;
    assert.equal((await app.request('/ready')).status, 503);
    assert.equal(check.mock.callCount(), 1);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal((await app.request('/ready')).status, 200);
    assert.equal(check.mock.callCount(), 2);
    await app.close();
  });

  it('cacheMs: 0 comprueba en cada petición', async () => {
    const check = mock.fn(() => true);
    const app = await start({ checks: { database: check }, cacheMs: 0 });

    await app.request('/ready');
    await app.request('/ready');

    assert.equal(check.mock.callCount(), 2);
    await app.close();
  });

  it('la función de forRoot puede usar inject() con providers globales', async () => {
    @Injectable()
    class Database {
      ping = () => false;
    }

    @Module({ providers: [Database], exports: [Database], global: true })
    class DatabaseModule {}

    @Module({
      imports: [
        DatabaseModule,
        HealthModule.forRoot(() => {
          const database = inject(Database);
          return { checks: { database: () => database.ping() } };
        }),
      ],
    })
    class AppModule {}

    const app = await createTestingApp(AppModule);
    assert.equal((await app.request('/ready')).status, 503);
    await app.close();
  });

  it('las rutas son públicas aunque la app tenga guard de autenticación', async () => {
    @Controller('/private')
    class PrivateController {
      @Get()
      read() {
        return 'secret';
      }
    }

    @Module({ imports: [HealthModule.forRoot()], controllers: [PrivateController] })
    class AppModule {}

    const app = await createTestingApp(AppModule, { configure: (it) => it.useAuthGuard(() => false) });

    assert.equal((await app.request('/private')).status, 401);
    assert.equal((await app.request('/health')).status, 200);
    assert.equal((await app.request('/ready')).status, 200);
    await app.close();
  });

  it('acepta otras rutas y respeta globalPrefix', async () => {
    const app = await start({}, { path: '/live', readyPath: 'status/ready' }, { globalPrefix: '/api' });

    assert.equal((await app.request('/api/live')).status, 200);
    assert.equal((await app.request('/api/status/ready')).status, 200);
    assert.equal((await app.request('/health')).status, 404);
    assert.equal((await app.request('/api/health')).status, 404);
    await app.close();
  });

  it('HealthService se puede usar desde otros providers', async () => {
    const app = await start({ checks: { database: () => false } });
    assert.equal(await app.get(HealthService).isReady(), false);
    await app.close();
  });

  it('rechaza opciones inválidas al arrancar', async () => {
    await assert.rejects(start({ timeoutMs: 0 }), /timeoutMs/);
    await assert.rejects(start({ timeoutMs: 1.5 }), /timeoutMs/);
    await assert.rejects(start({ cacheMs: -1 }), /cacheMs/);
    assert.throws(() => HealthModule.forRoot({}, { path: '/same', readyPath: 'same/' }), /same/);
  });
});
