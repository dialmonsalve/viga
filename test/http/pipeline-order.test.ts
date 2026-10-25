import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  Controller,
  Get,
  Module,
  RateLimit,
  UseGuards,
  UseInterceptors,
  type CallHandler,
} from '../../src/index.ts';
import { startTestServer, type TestServer } from '../helpers/http.ts';

const order: string[] = [];
const step = (name: string, allow = true) => () => {
  order.push(name);
  return allow;
};
const around = (name: string) => async (_ctx: unknown, next: CallHandler) => {
  order.push(name);
  return next();
};
const cache = async () => ({ cached: true });

@UseGuards(step('class guard'))
@UseInterceptors(around('class interceptor'))
@Controller('orders')
class OrdersController {
  @Get()
  @UseInterceptors(around('method interceptor'))
  @UseGuards(step('method guard'))
  list() {
    order.push('handler');
    return [];
  }

  @Get('secret')
  @UseGuards(step('method guard', false))
  secret() {
    return { secret: true };
  }

  @Get('limited')
  @RateLimit({ max: 1, windowMs: 60_000 })
  limited() {
    return { cached: false };
  }
}

@Module({ controllers: [OrdersController] })
class AppModule {}

describe('orden del pipeline HTTP', () => {
  let server: TestServer;
  let cacheEverything = false;

  before(async () => {
    server = await startTestServer(AppModule, {
      configure: (app) =>
        app
          .useAuthGuard(step('auth'))
          .useGlobalInterceptors(async (ctx, next) =>
            cacheEverything ? cache() : around('global interceptor')(ctx, next)
          ),
    });
  });

  after(() => server.close());

  beforeEach(() => {
    order.length = 0;
    cacheEverything = false;
  });

  it('ejecuta todos los guards antes que cualquier interceptor', async () => {
    await server.request('/orders');

    assert.deepEqual(order, [
      'auth',
      'class guard',
      'method guard',
      'global interceptor',
      'class interceptor',
      'method interceptor',
      'handler',
    ]);
  });

  it('un interceptor global que responde sin llamar a next no se salta el guard del método', async () => {
    cacheEverything = true;
    const response = await server.request('/orders/secret');

    assert.equal(response.status, 403);
  });

  it('un interceptor global de caché no se salta @RateLimit', async () => {
    cacheEverything = true;

    assert.equal((await server.request('/orders/limited')).status, 200);
    assert.equal((await server.request('/orders/limited')).status, 429);
  });
});
