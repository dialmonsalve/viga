import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { z } from 'zod';
import {
  Controller,
  DEFAULT_SECURITY_HEADERS,
  Delete,
  Get,
  Module,
  Patch,
  Post,
  Public,
  Put,
  createApp,
  rateLimit,
  silentLogger,
  type ApiErrorBody,
  type HttpContext,
} from '../../src/index.ts';
import { Validate } from '../../src/validation/index.ts';
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

  describe('trustProxy y X-Forwarded-For falsificado', () => {
    const statusesWith = async (trustProxy: true | number) => {
      const server = await startTestServer(EchoModule, {
        trustProxy,
        configure: (app) =>
          app.useAuthGuard(() => true).use(rateLimit({ max: 1, windowMs: 60_000 })),
      });
      try {
        const statuses: number[] = [];
        for (const forged of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) {
          const { status } = await server.request('/echo/ip', {
            headers: { 'x-forwarded-for': `${forged}, 203.0.113.9` },
          });
          statuses.push(status);
        }
        return statuses;
      } finally {
        await server.close();
      }
    };

    it('con el número de proxies, el cliente no puede cambiar su IP', async () => {
      assert.deepEqual(await statusesWith(1), [200, 429, 429]);
    });

    it('con trustProxy: true el cliente sí puede, y la app lo avisa al crearse', async () => {
      const warnings: string[] = [];
      createApp({
        rootModule: EchoModule,
        trustProxy: true,
        logger: { ...silentLogger, warn: (message) => warnings.push(message) },
      });

      assert.deepEqual(await statusesWith(true), [200, 200, 200]);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /trustProxy: true takes the client IP from the first X-Forwarded-For/);
    });

    it('no avisa con un número de proxies', () => {
      const warnings: string[] = [];
      createApp({
        rootModule: EchoModule,
        trustProxy: 1,
        logger: { ...silentLogger, warn: (message) => warnings.push(message) },
      });

      assert.deepEqual(warnings, []);
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

describe('requireValidation', () => {
  const Title = z.strictObject({ title: z.string() });

  @Controller('books')
  class ValidatedController {
    @Get()
    list() {
      return [];
    }

    @Post()
    @Validate({ body: Title })
    create({ body }: HttpContext) {
      return body;
    }

    @Put(':id')
    @Validate({ params: z.object({ id: z.string() }), body: Title })
    replace({ body }: HttpContext) {
      return body;
    }

    @Post('logout')
    @Validate({ body: z.strictObject({}).optional() })
    logout() {}
  }

  @Controller('loose')
  class LooseController {
    @Patch(':id')
    @Validate({ params: z.object({ id: z.string() }) })
    update({ body }: HttpContext) {
      return body;
    }
  }

  @Module({ controllers: [ValidatedController] })
  class ValidatedModule {}

  @Module({ controllers: [LooseController] })
  class LooseModule {}

  it('arranca cuando todas las rutas con body lo validan', async () => {
    const server = await startTestServer(ValidatedModule, { requireValidation: true });

    try {
      const { status } = await server.request('/books/logout', { method: 'POST' });
      assert.equal(status, 204);
    } finally {
      await server.close();
    }
  });

  it('falla al arrancar si una ruta POST, PUT o PATCH no valida el body', async () => {
    const app = createApp({
      rootModule: LooseModule,
      logger: silentLogger,
      requireValidation: true,
    });

    await assert.rejects(
      app.init(),
      /LooseController\.update handles PATCH but has no @Validate\(\{ body \}\)/
    );
  });

  describe('rutas sin body validado en otros métodos', () => {
    const getWithBody = (url: string, payload: string) =>
      new Promise<unknown>((resolve, reject) => {
        const req = httpRequest(
          url,
          {
            method: 'GET',
            agent: false,
            headers: {
              'content-type': 'application/json',
              'content-length': String(Buffer.byteLength(payload)),
            },
          },
          (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => (text += chunk));
            res.on('end', () => resolve(JSON.parse(text)));
          }
        );
        req.on('error', reject);
        req.end(payload);
      });

    @Public()
    @Controller('items')
    class ItemsController {
      @Delete(':id')
      remove({ body, req }: HttpContext) {
        return { body: body ?? null, raw: req.body ?? null };
      }

      @Get()
      list({ body }: HttpContext) {
        return { body: body ?? null };
      }
    }

    @Module({ controllers: [ItemsController] })
    class ItemsModule {}

    it('con requireValidation, el handler no recibe el body ni en ctx.body ni en ctx.req.body', async () => {
      const server = await startTestServer(ItemsModule, { requireValidation: true });

      try {
        const removed = await server.request('/items/1', {
          method: 'DELETE',
          json: { role: 'admin' },
        });
        const listed = await getWithBody(server.url('/items'), JSON.stringify({ role: 'admin' }));

        assert.deepEqual(removed.body, { body: null, raw: null });
        assert.deepEqual(listed, { body: null });
      } finally {
        await server.close();
      }
    });

    it('sin requireValidation, el body llega como antes', async () => {
      const server = await startTestServer(ItemsModule);

      try {
        const removed = await server.request('/items/1', {
          method: 'DELETE',
          json: { role: 'admin' },
        });

        assert.deepEqual(removed.body, { body: { role: 'admin' }, raw: { role: 'admin' } });
      } finally {
        await server.close();
      }
    });
  });

  it('no exige nada si la opción está desactivada', async () => {
    const app = createApp({ rootModule: LooseModule, logger: silentLogger });

    await app.init();
    await app.close();
  });
});

describe('concealRoutes', () => {
  @Controller('orders')
  class OrdersController {
    @Get()
    list() {
      return [];
    }

    @Get('health')
    @Public()
    health() {
      return { up: true };
    }
  }

  @Module({ controllers: [OrdersController] })
  class OrdersModule {}

  const authGuard = ({ req }: HttpContext) => req.headers.authorization === 'Bearer valido';
  const signedIn = { headers: { authorization: 'Bearer valido' } };

  describe('activado', () => {
    let server: TestServer;

    before(async () => {
      server = await startTestServer(OrdersModule, {
        concealRoutes: true,
        configure: (app) => app.useAuthGuard(authGuard),
      });
    });

    after(() => server.close());

    it('responde igual a una ruta privada y a una inexistente sin sesión', async () => {
      const existing = await server.request<ApiErrorBody>('/orders');
      const missing = await server.request<ApiErrorBody>('/admin/users');

      assert.equal(existing.status, 401);
      assert.equal(missing.status, 401);
      assert.equal(missing.body.code, existing.body.code);
    });

    it('responde 404 a una ruta inexistente con sesión', async () => {
      const { status, body } = await server.request<ApiErrorBody>('/admin/users', signedIn);

      assert.equal(status, 404);
      assert.equal(body.code, 'errors.routeNotFound');
    });

    it('mantiene accesibles las rutas públicas', async () => {
      assert.equal((await server.request('/orders/health')).status, 200);
    });
  });

  it('desactivado, una ruta inexistente responde 404 sin sesión', async () => {
    const server = await startTestServer(OrdersModule, {
      configure: (app) => app.useAuthGuard(authGuard),
    });

    try {
      assert.equal((await server.request('/admin/users')).status, 404);
    } finally {
      await server.close();
    }
  });
});
