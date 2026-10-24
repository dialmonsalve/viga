import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  Controller,
  Get,
  Module,
  REQUEST_ID,
  type ApiErrorBody,
  type Logger,
} from '../../src/index.ts';
import { startTestServer, type TestServer } from '../helpers/http.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

@Controller('ids')
class IdsController {
  @Get()
  current() {
    return { id: REQUEST_ID.get() };
  }

  @Get('boom')
  boom() {
    throw new Error('fallo interno');
  }
}

@Module({ controllers: [IdsController] })
class IdsModule {}

describe('request id', () => {
  describe('por defecto', () => {
    let server: TestServer;
    const errors: unknown[][] = [];
    const logger: Logger = {
      info() {},
      warn() {},
      debug() {},
      error: (...args) => errors.push(args),
    };

    before(async () => {
      server = await startTestServer(IdsModule, { logger });
    });

    after(() => server.close());

    it('genera un id por petición, lo devuelve en la cabecera y lo deja en el contexto', async () => {
      const { headers, body } = await server.request('/ids');

      assert.match(headers.get('x-request-id') ?? '', UUID);
      assert.equal(body.id, headers.get('x-request-id'));
    });

    it('ignora el id que envía el cliente', async () => {
      const { headers } = await server.request('/ids', {
        headers: { 'x-request-id': 'falso' },
      });

      assert.notEqual(headers.get('x-request-id'), 'falso');
    });

    it('incluye el id en el error y en el log de los 500', async () => {
      errors.length = 0;
      const { headers, body } = await server.request<ApiErrorBody>('/ids/boom');

      assert.equal(body.requestId, headers.get('x-request-id'));
      assert.deepEqual(errors[0]?.[2], { requestId: body.requestId });
    });
  });

  describe('con trustIncoming', () => {
    let server: TestServer;

    before(async () => {
      server = await startTestServer(IdsModule, { requestId: { trustIncoming: true } });
    });

    after(() => server.close());

    it('reutiliza un id entrante válido', async () => {
      const { headers } = await server.request('/ids', {
        headers: { 'x-request-id': 'gateway-123.abc' },
      });

      assert.equal(headers.get('x-request-id'), 'gateway-123.abc');
    });

    it('reemplaza un id entrante con caracteres peligrosos', async () => {
      const { headers } = await server.request('/ids', {
        headers: { 'x-request-id': 'id<script>' },
      });

      assert.match(headers.get('x-request-id') ?? '', UUID);
    });
  });

  it('se desactiva con requestId: false', async () => {
    const server = await startTestServer(IdsModule, { requestId: false });

    try {
      const { headers } = await server.request<ApiErrorBody>('/ids/boom');

      assert.equal(headers.get('x-request-id'), null);
    } finally {
      await server.close();
    }
  });
});
