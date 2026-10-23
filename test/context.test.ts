import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  Controller,
  Get,
  Injectable,
  Module,
  createContextKey,
  inject,
  runInNewContext,
  type CanActivate,
  type HttpContext,
} from '../src/index.ts';
import { startTestServer, type TestServer } from './helpers/http.ts';

describe('createContextKey', () => {
  const USER = createContextKey<string>('user');

  it('no tiene valor fuera de un contexto', () => {
    assert.equal(USER.find(), undefined);
    assert.throws(() => USER.get(), /\[Context\] There is no value for "user"/);
  });

  it('run() mantiene el valor a través de operaciones asíncronas', async () => {
    const value = await USER.run('ana', async () => {
      await sleep(5);
      return USER.get();
    });

    assert.equal(value, 'ana');
    assert.equal(USER.find(), undefined);
  });

  it('un run() anidado reemplaza el valor solo dentro de su función', () => {
    const seen = USER.run('ana', () => {
      const inner = USER.run('luis', () => USER.get());
      return [inner, USER.get()];
    });

    assert.deepEqual(seen, ['luis', 'ana']);
  });

  it('no mezcla valores de operaciones simultáneas', async () => {
    const delayed = (name: string, ms: number) =>
      USER.run(name, async () => {
        await sleep(ms);
        return USER.get();
      });

    const results = await Promise.all([delayed('ana', 15), delayed('luis', 5), delayed('eva', 1)]);

    assert.deepEqual(results, ['ana', 'luis', 'eva']);
  });

  it('claves distintas no se pisan aunque tengan la misma descripción', () => {
    const OTHER = createContextKey<string>('user');

    const seen = USER.run('ana', () => OTHER.run('luis', () => [USER.get(), OTHER.get()]));

    assert.deepEqual(seen, ['ana', 'luis']);
  });

  it('set() exige un contexto abierto', () => {
    assert.throws(() => USER.set('ana'), /can only be called inside a request/);
  });

  it('runInNewContext() abre un contexto vacío donde set() funciona', async () => {
    const value = await runInNewContext(async () => {
      USER.set('ana');
      await sleep(1);
      return USER.get();
    });

    assert.equal(value, 'ana');
    assert.equal(USER.find(), undefined);
  });

  it('runInNewContext() no hereda valores del contexto exterior', () => {
    const inner = USER.run('ana', () => runInNewContext(() => USER.find()));

    assert.equal(inner, undefined);
  });

  it('set() dentro de un run() anidado no modifica el contexto exterior', () => {
    const seen = runInNewContext(() => {
      USER.set('ana');
      USER.run('luis', () => USER.set('eva'));
      return USER.get();
    });

    assert.equal(seen, 'ana');
  });
});

const CURRENT_USER = createContextKey<{ id: string; name: string }>('currentUser');
const REQUEST_ID = createContextKey<string>('requestId');

@Injectable()
class AuditService {
  stamp() {
    return { by: CURRENT_USER.get().id, request: REQUEST_ID.get() };
  }
}

@Injectable()
class HeaderGuard implements CanActivate {
  canActivate({ req }: HttpContext) {
    const id = req.headers['x-user'];
    if (typeof id !== 'string') return false;
    CURRENT_USER.set({ id, name: id.toUpperCase() });
    return true;
  }
}

@Controller('/items')
class ItemsController {
  private readonly audit = inject(AuditService);

  @Get()
  async create() {
    await sleep(Number(CURRENT_USER.get().id === 'lento') * 20);
    return this.audit.stamp();
  }
}

@Module({ controllers: [ItemsController], providers: [AuditService] })
class ItemsModule {}

describe('contexto por petición', () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer(ItemsModule, {
      configure: (app) =>
        app
          .use((req, _res, next) => {
            REQUEST_ID.set(String(req.headers['x-request-id'] ?? 'sin-id'));
            next();
          })
          .useAuthGuard(HeaderGuard),
    });
  });

  after(() => server.close());

  it('lo que fijan middlewares y guards llega a los servicios', async () => {
    const { status, body } = await server.request('/items', {
      headers: { 'x-user': 'ana', 'x-request-id': 'r-1' },
    });

    assert.equal(status, 200);
    assert.deepEqual(body, { by: 'ana', request: 'r-1' });
  });

  it('cada petición tiene su propio contexto aunque se atiendan a la vez', async () => {
    const [slow, fast] = await Promise.all([
      server.request('/items', { headers: { 'x-user': 'lento', 'x-request-id': 'r-lento' } }),
      server.request('/items', { headers: { 'x-user': 'rapido', 'x-request-id': 'r-rapido' } }),
    ]);

    assert.deepEqual(slow.body, { by: 'lento', request: 'r-lento' });
    assert.deepEqual(fast.body, { by: 'rapido', request: 'r-rapido' });
  });

  it('no deja valores de una petición en la siguiente', async () => {
    await server.request('/items', { headers: { 'x-user': 'ana', 'x-request-id': 'r-1' } });
    const { body } = await server.request('/items', { headers: { 'x-user': 'luis' } });

    assert.deepEqual(body, { by: 'luis', request: 'sin-id' });
    assert.equal(CURRENT_USER.find(), undefined);
  });
});
