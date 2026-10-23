import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  Controller,
  Get,
  Injectable,
  InjectionToken,
  Module,
  UseInterceptors,
  inject,
  type CallHandler,
  type HttpContext,
  type Interceptor,
  type InterceptorFn,
} from '../../src/index.ts';
import { startTestServer, type TestServer } from '../helpers/http.ts';

const calls: string[] = [];
const TAG = new InjectionToken<string>('TAG');

const trace =
  (name: string): InterceptorFn =>
  async (_ctx, next) => {
    calls.push(`${name}:antes`);
    const result = await next();
    calls.push(`${name}:después`);
    return result;
  };

@Injectable()
class WrapInterceptor implements Interceptor {
  private readonly tag = inject(TAG);

  async intercept(_ctx: HttpContext, next: CallHandler) {
    return { [this.tag]: await next() };
  }
}

const cached: InterceptorFn = () => ({ cached: true });
const twice: InterceptorFn = async (_ctx, next) => {
  await next();
  return next();
};

@Controller('/items')
@UseInterceptors(trace('controlador'))
class ItemsController {
  @Get('/traced')
  @UseInterceptors(trace('método'))
  traced() {
    calls.push('handler');
    return 'ok';
  }

  @Get('/wrapped')
  @UseInterceptors(WrapInterceptor)
  wrapped() {
    return 'ok';
  }

  @Get('/cached')
  @UseInterceptors(cached)
  fromCache() {
    calls.push('handler-cacheado');
    return 'fresco';
  }

  @Get('/twice')
  @UseInterceptors(twice)
  callsTwice() {
    return 'ok';
  }
}

@Module({ controllers: [ItemsController], providers: [{ provide: TAG, useValue: 'data' }] })
class ItemsModule {}

describe('interceptores', () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer(ItemsModule, {
      configure: (app) => app.useAuthGuard(() => true).useGlobalInterceptors(trace('global')),
    });
  });

  after(() => server.close());

  it('se ejecutan de afuera hacia adentro: global, controlador, método', async () => {
    calls.length = 0;
    const { body } = await server.request('/items/traced');

    assert.equal(body, 'ok');
    assert.deepEqual(calls, [
      'global:antes',
      'controlador:antes',
      'método:antes',
      'handler',
      'método:después',
      'controlador:después',
      'global:después',
    ]);
  });

  it('las clases interceptoras usan inject() y pueden transformar la respuesta', async () => {
    const { body } = await server.request('/items/wrapped');

    assert.deepEqual(body, { data: 'ok' });
  });

  it('pueden responder sin llamar al handler', async () => {
    calls.length = 0;
    const { body } = await server.request('/items/cached');

    assert.deepEqual(body, { cached: true });
    assert.ok(!calls.includes('handler-cacheado'));
  });

  it('next() solo puede llamarse una vez', async () => {
    const { status } = await server.request('/items/twice');

    assert.equal(status, 500);
  });
});
