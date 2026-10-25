import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  Controller,
  Get,
  Injectable,
  Module,
  Public,
  UseGuards,
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

describe('@UseGuards en el controlador', () => {
  const order: string[] = [];
  const isAdmin = ({ req }: HttpContext) => {
    order.push('controlador');
    return req.headers['x-role'] === 'admin';
  };

  @UseGuards(isAdmin)
  @Controller('/admin')
  class AdminController {
    @Get()
    @UseGuards(() => {
      order.push('método');
      return true;
    })
    panel() {
      return { admin: true };
    }

    @Get('/health')
    @Public()
    health() {
      return { up: true };
    }
  }

  @Module({ controllers: [AdminController] })
  class AdminModule {}

  let server: TestServer;

  before(async () => {
    server = await startTestServer(AdminModule, {
      configure: (app) => app.useAuthGuard(TokenGuard),
    });
  });

  after(() => server.close());

  const asUser = (role: string) => ({
    headers: { authorization: 'Bearer valido', 'x-role': role },
  });

  it('protege todas las rutas del controlador', async () => {
    assert.equal((await server.request('/admin', asUser('cashier'))).status, 403);
    assert.equal((await server.request('/admin/health', asUser('cashier'))).status, 403);
  });

  it('se ejecuta después de la autenticación', async () => {
    order.length = 0;
    const { status } = await server.request('/admin', { headers: { 'x-role': 'admin' } });

    assert.equal(status, 401);
    assert.deepEqual(order, []);
  });

  it('se ejecuta antes que los guards del método', async () => {
    order.length = 0;
    const { status } = await server.request('/admin', asUser('admin'));

    assert.equal(status, 200);
    assert.deepEqual(order, ['controlador', 'método']);
  });
});

describe('@Public con herencia', () => {
  @Public()
  @Controller('/base')
  class PublicBaseController {
    @Get('/info')
    info() {
      return { info: true };
    }
  }

  @Controller('/admin')
  class AdminController extends PublicBaseController {
    @Get('/users')
    users() {
      return [];
    }
  }

  @Controller('/health')
  class HealthController {
    @Public()
    @Get()
    check() {
      return { up: true };
    }
  }

  @Controller('/health-v2')
  class HealthV2Controller extends HealthController {
    override check() {
      return { up: true, secret: 'interno' };
    }
  }

  @Module({ controllers: [PublicBaseController, AdminController, HealthController, HealthV2Controller] })
  class InheritanceModule {}

  let server: TestServer;

  before(async () => {
    server = await startTestServer(InheritanceModule, { configure: (app) => app.useAuthGuard(() => false) });
  });

  after(() => server.close());

  it('una subclase de un controlador @Public exige autenticación', async () => {
    assert.equal((await server.request('/base/info')).status, 200);
    assert.equal((await server.request('/admin/info')).status, 401);
    assert.equal((await server.request('/admin/users')).status, 401);
  });

  it('un método @Public sobrescrito exige autenticación', async () => {
    assert.equal((await server.request('/health')).status, 200);
    assert.equal((await server.request('/health-v2')).status, 401);
  });
});
