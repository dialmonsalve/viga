import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  Controller,
  Get,
  Injectable,
  Module,
  Public,
  type ApiErrorBody,
  type CanActivate,
  type HttpContext,
} from '../../src/index.ts';
import { startTestServer, type TestServer } from '../helpers/http.ts';

@Controller('/account')
class AccountController {
  @Get()
  me() {
    return { private: true };
  }

  @Get('/status')
  @Public()
  status() {
    return { up: true };
  }
}

@Controller('/docs')
@Public()
class DocsController {
  @Get()
  index() {
    return { docs: true };
  }
}

@Module({ controllers: [AccountController, DocsController] })
class AppModule {}

@Injectable()
class TokenGuard implements CanActivate {
  canActivate({ req }: HttpContext) {
    return req.headers.authorization === 'Bearer valido';
  }
}

describe('rutas privadas por defecto', () => {
  describe('con un guard de autenticación', () => {
    let server: TestServer;

    before(async () => {
      server = await startTestServer(AppModule, {
        configure: (app) => app.useAuthGuard(TokenGuard),
      });
    });

    after(() => server.close());

    it('responde 401 sin sesión válida', async () => {
      const { status, body } = await server.request<ApiErrorBody>('/account');

      assert.equal(status, 401);
      assert.equal(body.code, 'errors.unauthorized');
    });

    it('deja pasar cuando el guard acepta', async () => {
      const { status, body } = await server.request('/account', {
        headers: { authorization: 'Bearer valido' },
      });

      assert.equal(status, 200);
      assert.deepEqual(body, { private: true });
    });

    it('@Public() en un método lo deja abierto', async () => {
      const { status } = await server.request('/account/status');

      assert.equal(status, 200);
    });

    it('@Public() en el controlador abre todas sus rutas', async () => {
      const { status } = await server.request('/docs');

      assert.equal(status, 200);
    });
  });

  describe('sin guard de autenticación configurado', () => {
    let server: TestServer;

    before(async () => {
      server = await startTestServer(AppModule, { configure: () => {} });
    });

    after(() => server.close());

    it('cierra toda ruta que no sea pública', async () => {
      assert.equal((await server.request('/account')).status, 401);
      assert.equal((await server.request('/account/status')).status, 200);
    });
  });
});
