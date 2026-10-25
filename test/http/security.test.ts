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
  UseGuards,
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
  @Validate({ body: z.unknown() })
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

  @Public()
  @Controller('books')
  class BooksController {
    @Post()
    @Validate({ body: Title })
    create({ body }: HttpContext) {
      return body;
    }

    @Post('logout')
    logout() {}

    @Patch(':id')
    @Validate({ params: z.object({ id: z.string() }) })
    touch({ body, req }: HttpContext) {
      return { body: body ?? null, raw: req.body ?? null };
    }

    @Delete(':id')
    remove({ body }: HttpContext) {
      return { body: body ?? null };
    }

    @Get()
    list({ body }: HttpContext) {
      return { body: body ?? null };
    }
  }

  @Module({ controllers: [BooksController] })
  class BooksModule {}

  const getWithBody = (url: string, payload: string) =>
    new Promise<{ status: number; body: ApiErrorBody }>((resolve, reject) => {
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
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) }));
        }
      );
      req.on('error', reject);
      req.end(payload);
    });

  let server: TestServer;

  before(async () => {
    server = await startTestServer(BooksModule);
  });

  after(() => server.close());

  it('una ruta que no recibe body no necesita @Validate', async () => {
    assert.equal((await server.request('/books/logout', { method: 'POST' })).status, 204);
    assert.equal((await server.request('/books/1', { method: 'PATCH' })).status, 200);
  });

  it('responde 400 si llega un body a una ruta sin esquema de body, en cualquier método', async () => {
    const payload = { role: 'admin' };
    const responses = [
      await server.request<ApiErrorBody>('/books/logout', { method: 'POST', json: payload }),
      await server.request<ApiErrorBody>('/books/1', { method: 'PATCH', json: payload }),
      await server.request<ApiErrorBody>('/books/1', { method: 'DELETE', json: payload }),
      await getWithBody(server.url('/books'), JSON.stringify(payload)),
    ];

    for (const response of responses) {
      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'errors.unexpectedBody');
    }
  });

  it('valida el body en las rutas que lo declaran', async () => {
    const created = await server.request('/books', { method: 'POST', json: { title: 'Dune' } });
    const invalid = await server.request<ApiErrorBody>('/books', {
      method: 'POST',
      json: { title: 'Dune', role: 'admin' },
    });

    assert.equal(created.status, 201);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, 'errors.validation');
  });

  it('sin requireValidation, el body llega como antes', async () => {
    const loose = await startTestServer(BooksModule, { requireValidation: false });

    try {
      const touched = await loose.request('/books/1', { method: 'PATCH', json: { role: 'admin' } });

      assert.deepEqual(touched.body, { body: { role: 'admin' }, raw: { role: 'admin' } });
    } finally {
      await loose.close();
    }
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

  it('por defecto se activa cuando hay guard de autenticación', async () => {
    const server = await startTestServer(OrdersModule, {
      configure: (app) => app.useAuthGuard(authGuard),
    });

    try {
      assert.equal((await server.request('/admin/users')).status, 401);
      assert.equal((await server.request('/admin/users', signedIn)).status, 404);
    } finally {
      await server.close();
    }
  });

  it('por defecto no se activa sin guard de autenticación, para no convertir cada 404 en 401', async () => {
    const server = await startTestServer(OrdersModule, { configure: () => undefined });

    try {
      assert.equal((await server.request('/admin/users')).status, 404);
    } finally {
      await server.close();
    }
  });

  it('desactivado, una ruta inexistente responde 404 sin sesión', async () => {
    const server = await startTestServer(OrdersModule, {
      concealRoutes: false,
      configure: (app) => app.useAuthGuard(authGuard),
    });

    try {
      assert.equal((await server.request('/admin/users')).status, 404);
    } finally {
      await server.close();
    }
  });
});

describe('cuerpo de la petición', () => {
  const Note = z.object({ text: z.string() });
  const seen: { raw: unknown; parsed: unknown }[] = [];

  @Controller('notes')
  class NotesController {
    @Post()
    @Validate({ body: Note })
    create({ req, body }: HttpContext<{ body: typeof Note }>) {
      seen.push({ raw: req.body, parsed: body });
      return body;
    }

    @Post('limited')
    @Public()
    @UseGuards(({ req }: HttpContext) => req.body?.text !== 'bloqueado')
    @Validate({ body: Note })
    limited() {
      return 'ok';
    }
  }

  @Module({ controllers: [NotesController] })
  class NotesModule {}

  let server: TestServer;
  const signedIn = { authorization: 'Bearer valido' };
  const post = (path: string, body: string, headers: Record<string, string> = {}) =>
    server.request<ApiErrorBody>(path, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', ...headers },
    });

  before(async () => {
    server = await startTestServer(NotesModule, {
      configure: (app) => app.useAuthGuard(({ req }) => req.headers.authorization === 'Bearer valido'),
    });
  });

  after(() => server.close());

  it('no parsea el cuerpo de quien no está autenticado', async () => {
    assert.equal((await post('/notes', '{roto')).status, 401);
    assert.equal((await post('/notes', JSON.stringify({ text: 'x'.repeat(200_000) }))).status, 401);
    assert.equal((await post('/nope', '{roto')).status, 401);
  });

  it('los guards ven el cuerpo parseado, por ejemplo para limitar por email', async () => {
    assert.equal((await post('/notes/limited', JSON.stringify({ text: 'bloqueado' }))).status, 403);
    assert.equal((await post('/notes/limited', JSON.stringify({ text: 'hola' }))).status, 201);
  });

  it('parsea y valida el cuerpo una vez autenticado', async () => {
    assert.equal((await post('/notes', '{roto', signedIn)).status, 400);
    assert.equal((await post('/notes', JSON.stringify({ text: 'x'.repeat(200_000) }), signedIn)).status, 413);
  });

  it('ctx.req.body queda con el valor validado, sin los campos que el esquema descarta', async () => {
    seen.length = 0;
    const response = await post('/notes', JSON.stringify({ text: 'hola', role: 'admin' }), signedIn);

    assert.equal(response.status, 201);
    assert.deepEqual(seen, [{ raw: { text: 'hola' }, parsed: { text: 'hola' } }]);
  });
});
