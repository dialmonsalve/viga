import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  Controller,
  Get,
  ipKey,
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

describe('rateLimit con IPv6', () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer(AppModule, {
      trustProxy: 1,
      configure: (app) => app.use(rateLimit({ max: 1, windowMs: 60_000 })),
    });
  });

  after(() => server.close());

  const from = (ip: string) => server.request('/auth/status', { headers: { 'x-forwarded-for': ip } });

  it('cuenta todas las direcciones de una misma red /56 como un solo cliente', async () => {
    assert.equal((await from('2001:db8:aa:bb01::1')).status, 200);
    assert.equal((await from('2001:db8:aa:bbff:1234:5678:9abc:def0')).status, 429);
    assert.equal((await from('2001:db8:aa:cc00::1')).status, 200);
  });

  it('cuenta igual una IPv4 y su forma IPv4-mapped', async () => {
    assert.equal((await from('198.51.100.7')).status, 200);
    assert.equal((await from('::ffff:198.51.100.7')).status, 429);
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

  it('al llenarse desaloja primero las claves con un solo intento', () => {
    const store = new MemoryRateLimitStore({ maxKeys: 3 });

    store.hit('a', 60_000);
    store.hit('a', 60_000);
    store.hit('b', 60_000);
    store.hit('c', 60_000);
    store.hit('d', 60_000);

    assert.equal(store.size, 3);
    assert.equal(store.hit('a', 60_000).count, 3);
    assert.equal(store.hit('c', 60_000).count, 2);
    assert.equal(store.hit('d', 60_000).count, 2);
  });

  it('no pierde el contador de una clave atacada aunque lleguen miles de claves nuevas', () => {
    const store = new MemoryRateLimitStore({ maxKeys: 100 });

    for (let i = 0; i < 5; i++) store.hit('victima', 60_000);
    for (let i = 0; i < 10_000; i++) store.hit(`relleno-${i}`, 60_000);

    assert.equal(store.hit('victima', 60_000).count, 6);
  });

  it('trata como limitada una clave nueva cuando todas las guardadas siguen vivas y repetidas', () => {
    const store = new MemoryRateLimitStore({ maxKeys: 2 });

    store.hit('a', 60_000);
    store.hit('a', 60_000);
    store.hit('b', 60_000);
    store.hit('b', 60_000);

    const hit = store.hit('c', 60_000);
    assert.ok(hit.count > 1_000_000);
    assert.ok(hit.resetAt > Date.now());
    assert.ok(hit.resetAt <= Date.now() + 60_000);
    assert.equal(store.size, 2);
    assert.equal(store.hit('a', 60_000).count, 3);
  });

  it('vuelve a aceptar claves nuevas cuando vencen las guardadas', async () => {
    const store = new MemoryRateLimitStore({ maxKeys: 1 });

    store.hit('a', 20);
    store.hit('a', 20);
    assert.ok(store.hit('b', 20).count > 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(store.hit('b', 20).count, 1);
  });

  it('libera espacio en cuanto vence una clave aunque la ventana del barrido sea más larga', async () => {
    const store = new MemoryRateLimitStore({ maxKeys: 1 });

    store.hit('a', 20);
    store.hit('a', 20);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(store.hit('b', 60_000).count, 1);
    assert.equal(store.size, 1);
  });

  it('responde 429 con un Retry-After finito cuando el almacén está saturado', async () => {
    const store = new MemoryRateLimitStore({ maxKeys: 1 });
    const server = await startTestServer(AppModule, {
      configure: (app) =>
        app.use(
          rateLimit({ max: 5, windowMs: 60_000, store, key: (req) => String(req.headers['x-client']) })
        ),
    });

    try {
      await server.request('/auth/status', { headers: { 'x-client': 'a' } });
      await server.request('/auth/status', { headers: { 'x-client': 'a' } });
      const blocked = await server.request('/auth/status', { headers: { 'x-client': 'b' } });

      assert.equal(blocked.status, 429);
      const retryAfter = Number(blocked.headers.get('retry-after'));
      assert.ok(retryAfter > 0 && retryAfter <= 60);
    } finally {
      await server.close();
    }
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

describe('ipKey', () => {
  it('reduce IPv6 a su red /56 en forma canónica', () => {
    assert.equal(ipKey('2001:DB8:aa:bb01::1'), '2001:db8:aa:bb00:0:0:0:0/56');
    assert.equal(ipKey('2001:0db8:00aa:bbff:1:2:3:4'), '2001:db8:aa:bb00:0:0:0:0/56');
    assert.equal(ipKey('::1'), '0:0:0:0:0:0:0:0/56');
  });

  it('acepta otra longitud de prefijo', () => {
    assert.equal(ipKey('2001:db8:aa:bbff::1', 64), '2001:db8:aa:bbff:0:0:0:0/64');
    assert.equal(ipKey('2001:db8:aa:bbff::1', 50), '2001:db8:aa:8000:0:0:0:0/50');
    assert.equal(ipKey('2001:db8::1', 128), '2001:db8:0:0:0:0:0:1/128');
  });

  it('devuelve la IPv4 de una dirección IPv4-mapped e ignora la zona', () => {
    assert.equal(ipKey('::ffff:198.51.100.7'), '198.51.100.7');
    assert.equal(ipKey('::ffff:c633:6407'), '198.51.100.7');
    assert.equal(ipKey('fe80::1%eth0', 64), 'fe80:0:0:0:0:0:0:0/64');
  });

  it('deja intactas las IPv4 y los valores que no son IP', () => {
    assert.equal(ipKey('198.51.100.7'), '198.51.100.7');
    assert.equal(ipKey('unknown'), 'unknown');
  });

  it('rechaza un prefijo fuera de rango', () => {
    assert.throws(() => ipKey('::1', 0), /ipv6Subnet must be an integer between 1 and 128/);
    assert.throws(() => ipKey('::1', 129), /ipv6Subnet/);
  });
});
