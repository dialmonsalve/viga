import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  Controller,
  Get,
  MemoryRateLimitStore,
  Module,
  Post,
  Public,
  RateLimit,
  rateLimit,
  type ApiErrorBody,
} from '../../src/index.ts';
import { startTestServer, type TestServer } from '../helpers/http.ts';

@Public()
@Controller('auth')
class AuthController {
  @Post('login')
  @RateLimit({ max: 2, windowMs: 60_000 })
  login() {
    return { token: 'abc' };
  }

  @Get('status')
  status() {
    return { ok: true };
  }
}

@Public()
@RateLimit({ max: 1, windowMs: 60_000, key: (req) => String(req.headers['x-client']) })
@Controller('reports')
class ReportsController {
  @Get()
  list() {
    return [];
  }
}

@Module({ controllers: [AuthController, ReportsController] })
class AppModule {}

describe('rate limiting', () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer(AppModule);
  });

  after(() => server.close());

  it('responde 429 con Retry-After al superar el límite de la ruta', async () => {
    const first = await server.request('/auth/login', { method: 'POST' });
    const second = await server.request('/auth/login', { method: 'POST' });
    const third = await server.request<ApiErrorBody>('/auth/login', { method: 'POST' });

    assert.equal(first.status, 201);
    assert.equal(first.headers.get('ratelimit-limit'), '2');
    assert.equal(first.headers.get('ratelimit-remaining'), '1');
    assert.equal(second.headers.get('ratelimit-remaining'), '0');
    assert.equal(third.status, 429);
    assert.equal(third.body.code, 'errors.tooManyRequests');
    assert.ok(Number(third.headers.get('retry-after')) > 0);
  });

  it('no limita las otras rutas del controlador', async () => {
    const { status, headers } = await server.request('/auth/status');

    assert.equal(status, 200);
    assert.equal(headers.get('ratelimit-limit'), null);
  });

  it('aplica el límite a todo el controlador con una clave propia', async () => {
    const a1 = await server.request('/reports', { headers: { 'x-client': 'a' } });
    const a2 = await server.request('/reports', { headers: { 'x-client': 'a' } });
    const b1 = await server.request('/reports', { headers: { 'x-client': 'b' } });

    assert.equal(a1.status, 200);
    assert.equal(a2.status, 429);
    assert.equal(b1.status, 200);
  });
});

describe('rateLimit global', () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer(AppModule, {
      configure: (app) => app.use(rateLimit({ max: 1, windowMs: 60_000 })),
    });
  });

  after(() => server.close());

  it('limita todas las rutas como middleware', async () => {
    assert.equal((await server.request('/auth/status')).status, 200);
    assert.equal((await server.request('/auth/status')).status, 429);
  });
});

describe('MemoryRateLimitStore', () => {
  it('reinicia el contador cuando termina la ventana', async () => {
    const store = new MemoryRateLimitStore();

    assert.equal(store.hit('ip', 20).count, 1);
    assert.equal(store.hit('ip', 20).count, 2);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(store.hit('ip', 20).count, 1);
  });

  it('no guarda más de maxKeys claves y desaloja la más antigua', () => {
    const store = new MemoryRateLimitStore({ maxKeys: 3 });

    store.hit('a', 60_000);
    store.hit('a', 60_000);
    store.hit('b', 60_000);
    store.hit('c', 60_000);
    store.hit('d', 60_000);

    assert.equal(store.size, 3);
    assert.equal(store.hit('b', 60_000).count, 2);
    assert.equal(store.hit('a', 60_000).count, 1);
  });

  it('mantiene acotada la memoria con miles de claves únicas dentro de la ventana', () => {
    const store = new MemoryRateLimitStore();

    for (let i = 0; i < 50_000; i++) store.hit(`ip:${'x'.repeat(500)}${i}@mail.com`, 15 * 60_000);

    assert.equal(store.size, 10_000);
  });

  it('cuenta por separado claves largas distintas y junta las iguales', () => {
    const store = new MemoryRateLimitStore();
    const long = 'x'.repeat(1_000);

    store.hit(`${long}a`, 60_000);
    assert.equal(store.hit(`${long}a`, 60_000).count, 2);
    assert.equal(store.hit(`${long}b`, 60_000).count, 1);
  });

  it('rechaza un maxKeys que no es un entero positivo', () => {
    assert.throws(() => new MemoryRateLimitStore({ maxKeys: 0 }), /maxKeys must be a positive integer/);
  });

  it('rechaza opciones inválidas al crear el límite', () => {
    assert.throws(() => rateLimit({ max: 0, windowMs: 1000 }), /positive integers/);
    assert.throws(() => rateLimit({ max: 5, windowMs: 1.5 }), /positive integers/);
  });
});
