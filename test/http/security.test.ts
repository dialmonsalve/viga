import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  Controller,
  DEFAULT_SECURITY_HEADERS,
  Get,
  Module,
  Post,
  createApp,
  silentLogger,
  type ApiErrorBody,
  type HttpContext,
} from '../../src/index.ts';
import { startTestServer, type TestServer } from '../helpers/http.ts';

@Controller('echo')
class EchoController {
  @Post()
  echo({ body }: HttpContext) {
    return body;
  }

  @Get('ip')
  ip({ req }: HttpContext) {
    return { ip: req.ip };
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

describe('seguridad HTTP', () => {
  describe('valores por defecto', () => {
    let server: TestServer;

    before(async () => {
      server = await startTestServer(EchoModule);
    });

    after(() => server.close());

    it('no expone X-Powered-By', async () => {
      const { headers } = await server.request('/echo/ip');

      assert.equal(headers.get('x-powered-by'), null);
    });

    it('envía las cabeceras de seguridad en respuestas correctas y de error', async () => {
      for (const path of ['/echo/ip', '/nope']) {
        const { headers } = await server.request(path);

        for (const [name, value] of Object.entries(DEFAULT_SECURITY_HEADERS)) {
          assert.equal(headers.get(name), value, `${path} ${name}`);
        }
      }
    });

    it('no refleja la ruta pedida en el 404', async () => {
      const { status, body } = await server.request<ApiErrorBody>('/<script>alert(1)</script>');

      assert.equal(status, 404);
      assert.doesNotMatch(JSON.stringify(body), /script/);
    });

    it('rechaza con 413 un body mayor al límite por defecto', async () => {
      const { status, body } = await server.request<ApiErrorBody>('/echo', {
        method: 'POST',
        json: { data: 'x'.repeat(200 * 1024) },
      });

      assert.equal(status, 413);
      assert.equal(body.code, 'errors.payloadTooLarge');
    });

    it('ignora X-Forwarded-For si no se configura trustProxy', async () => {
      const { body } = await server.request('/echo/ip', {
        headers: { 'x-forwarded-for': '203.0.113.7' },
      });

      assert.notEqual(body.ip, '203.0.113.7');
    });

    it('aplica timeouts acotados al servidor', async () => {
      const app = createApp({ rootModule: EchoModule, logger: silentLogger });
      const httpServer = await app.listen(0, '127.0.0.1');

      try {
        assert.equal(httpServer.headersTimeout, 10_000);
        assert.equal(httpServer.requestTimeout, 30_000);
        assert.equal(httpServer.keepAliveTimeout, 5_000);
      } finally {
        await app.close();
      }
    });
  });

  describe('configuración', () => {
    let server: TestServer;

    before(async () => {
      server = await startTestServer(EchoModule, {
        bodyLimit: '1kb',
        trustProxy: 'loopback',
        securityHeaders: { 'cache-control': 'private, max-age=60', 'X-Frame-Options': false },
      });
    });

    after(() => server.close());

    it('permite cambiar o quitar cabeceras de seguridad', async () => {
      const { headers } = await server.request('/echo/ip');

      assert.equal(headers.get('cache-control'), 'private, max-age=60');
      assert.equal(headers.get('x-frame-options'), null);
      assert.equal(headers.get('x-content-type-options'), 'nosniff');
    });

    it('respeta el bodyLimit configurado', async () => {
      const { status } = await server.request('/echo', {
        method: 'POST',
        json: { data: 'x'.repeat(2 * 1024) },
      });

      assert.equal(status, 413);
    });

    it('usa X-Forwarded-For cuando el proxy es de confianza', async () => {
      const { body } = await server.request('/echo/ip', {
        headers: { 'x-forwarded-for': '203.0.113.7' },
      });

      assert.equal(body.ip, '203.0.113.7');
    });

    it('aplica los timeouts configurados', async () => {
      const app = createApp({
        rootModule: EchoModule,
        logger: silentLogger,
        timeouts: { headers: 2_000, request: 4_000 },
      });
      const httpServer = await app.listen(0, '127.0.0.1');

      try {
        assert.equal(httpServer.headersTimeout, 2_000);
        assert.equal(httpServer.requestTimeout, 4_000);
        assert.equal(httpServer.keepAliveTimeout, 5_000);
      } finally {
        await app.close();
      }
    });
  });

  it('desactiva las cabeceras de seguridad con securityHeaders: false', async () => {
    const server = await startTestServer(EchoModule, { securityHeaders: false });

    try {
      const { headers } = await server.request('/echo/ip');

      assert.equal(headers.get('content-security-policy'), null);
      assert.equal(headers.get('x-powered-by'), null);
    } finally {
      await server.close();
    }
  });
});
