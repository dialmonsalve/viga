import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  Controller,
  Delete,
  Get,
  Module,
  Post,
  Public,
  Put,
  createApp,
  type ApiErrorBody,
} from '../../src/index.ts';
import { startTestServer, type TestServer } from '../helpers/http.ts';

const calls = { count: 0 };

@Public()
@Controller('account')
class AccountController {
  @Post('transfer')
  transfer() {
    calls.count++;
    return { ok: true };
  }

  @Put('email')
  email() {
    calls.count++;
    return { ok: true };
  }

  @Delete()
  remove() {
    calls.count++;
    return { ok: true };
  }

  @Get()
  show() {
    return { ok: true };
  }
}

@Module({ controllers: [AccountController] })
class AppModule {}

const form = { 'content-type': 'application/x-www-form-urlencoded' };

describe('protección CSRF', () => {
  let server: TestServer;
  const post = (headers: Record<string, string>, body?: string) =>
    server.request<ApiErrorBody>('/account/transfer', { method: 'POST', headers, body });

  before(async () => {
    server = await startTestServer(AppModule, { requireValidation: false });
  });

  after(() => server.close());

  beforeEach(() => {
    calls.count = 0;
  });

  it('rechaza con 403 un formulario enviado desde otro sitio sin ejecutar el handler', async () => {
    const response = await post({ ...form, 'sec-fetch-site': 'cross-site' }, 'amount=1000');

    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'errors.crossSiteRequest');
    assert.equal(calls.count, 0);
  });

  it('rechaza los POST simples de otro sitio: sin cuerpo, text/plain o multipart', async () => {
    const crossSite = { 'sec-fetch-site': 'cross-site' };

    assert.equal((await post(crossSite)).status, 403);
    const plain = { ...crossSite, 'content-type': 'Text/Plain; charset=utf-8' };
    assert.equal((await post(plain, '{}')).status, 403);
    assert.equal(
      (await post({ ...crossSite, 'content-type': 'multipart/form-data; boundary=x' }, '--x--')).status,
      403
    );
    assert.equal((await post({ ...crossSite, 'sec-fetch-site': 'same-site', ...form }, 'a=1')).status, 403);
    assert.equal(calls.count, 0);
  });

  it('acepta formularios del mismo origen y navegaciones directas', async () => {
    assert.equal((await post({ ...form, 'sec-fetch-site': 'same-origin' }, 'a=1')).status, 201);
    assert.equal((await post({ ...form, 'sec-fetch-site': 'none' }, 'a=1')).status, 201);
  });

  it('acepta JSON de otro sitio porque el navegador lo envía solo tras un preflight CORS', async () => {
    const response = await server.request('/account/transfer', {
      method: 'POST',
      json: { amount: 1 },
      headers: { 'sec-fetch-site': 'cross-site', origin: 'https://app.example' },
    });

    assert.equal(response.status, 201);
  });

  it('sin Sec-Fetch-Site compara Origin con Host', async () => {
    const sameOrigin = new URL(server.url('/')).origin;

    assert.equal((await post({ ...form, origin: 'https://evil.example' }, 'a=1')).status, 403);
    assert.equal((await post({ ...form, origin: 'null' }, 'a=1')).status, 403);
    assert.equal((await post({ ...form, origin: sameOrigin }, 'a=1')).status, 201);
  });

  it('acepta clientes que no son navegadores, sin Origin ni Sec-Fetch-Site', async () => {
    assert.equal((await post(form, 'a=1')).status, 201);
  });

  it('no revisa GET ni los métodos que siempre requieren preflight', async () => {
    const crossSite = { ...form, 'sec-fetch-site': 'cross-site' };

    assert.equal((await server.request('/account', { headers: crossSite })).status, 200);
    const put = await server.request('/account/email', { method: 'PUT', headers: crossSite });
    assert.equal(put.status, 200);
    assert.equal((await server.request('/account', { method: 'DELETE', headers: crossSite })).status, 200);
  });

  it('rechaza antes de leer el cuerpo, así que un formulario enorme de otro sitio recibe 403 y no 413', async () => {
    const response = await post({ ...form, 'sec-fetch-site': 'cross-site' }, `a=${'x'.repeat(200_000)}`);

    assert.equal(response.status, 403);
  });
});

describe('opción csrf', () => {
  it('trustedOrigins permite formularios de los orígenes listados', async () => {
    const server = await startTestServer(AppModule, {
      requireValidation: false,
      csrf: { trustedOrigins: ['https://idp.example'] },
    });

    try {
      const send = (origin: string) =>
        server.request('/account/transfer', {
          method: 'POST',
          headers: { ...form, 'sec-fetch-site': 'cross-site', origin },
          body: 'code=abc',
        });

      assert.equal((await send('https://idp.example')).status, 201);
      assert.equal((await send('https://idp.example.evil.example')).status, 403);
    } finally {
      await server.close();
    }
  });

  it('false desactiva la protección', async () => {
    const server = await startTestServer(AppModule, { csrf: false, requireValidation: false });

    try {
      const response = await server.request('/account/transfer', {
        method: 'POST',
        headers: { ...form, 'sec-fetch-site': 'cross-site' },
        body: 'a=1',
      });
      assert.equal(response.status, 201);
    } finally {
      await server.close();
    }
  });

  it('rechaza un origen de confianza mal escrito al crear la app', () => {
    for (const origin of ['https://idp.example/', 'idp.example', 'https://idp.example/login', '*']) {
      assert.throws(
        () => createApp({ rootModule: AppModule, csrf: { trustedOrigins: [origin] } }),
        /csrf\.trustedOrigins must contain origins like https:\/\/app\.example/
      );
    }
  });
});
