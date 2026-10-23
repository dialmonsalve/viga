import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import {
  ForbiddenException,
  Injectable,
  InjectionToken,
  Injector,
  UseGuards,
  inject,
  type CanActivate,
  type HttpContext,
} from '../../src/index.ts';
import { Validate } from '../../src/validation/index.ts';
import { createTestContext } from '../helpers/context.ts';

const REQUIRED_ROLE = new InjectionToken<string>('REQUIRED_ROLE');

@Injectable()
class RoleGuard implements CanActivate {
  private readonly role = inject(REQUIRED_ROLE);

  canActivate({ req }: HttpContext) {
    return req.headers['x-role'] === this.role;
  }
}

const allow = () => true;
const deny = () => false;
const allowLater = async () => {
  await Promise.resolve();
  return true;
};

class AdminController {
  calls = 0;

  @UseGuards(RoleGuard)
  async byRole(_ctx: HttpContext) {
    this.calls++;
    return 'ok';
  }

  @UseGuards(allow, allowLater)
  async open(_ctx: HttpContext) {
    this.calls++;
    return 'ok';
  }

  @UseGuards(allow, deny)
  async closed(_ctx: HttpContext) {
    this.calls++;
    return 'ok';
  }

  @UseGuards(deny)
  @Validate({ body: z.object({ title: z.string() }) })
  async guardedAndValidated(_ctx: HttpContext) {
    this.calls++;
    return 'ok';
  }
}

function createController() {
  const injector = new Injector([{ provide: REQUIRED_ROLE, useValue: 'admin' }]);
  return injector.instantiate(AdminController);
}

describe('@UseGuards', () => {
  it('ejecuta el handler cuando todos los guards lo permiten', async () => {
    const controller = createController();

    assert.equal(await controller.open(createTestContext()), 'ok');
    assert.equal(controller.calls, 1);
  });

  it('lanza ForbiddenException y no ejecuta el handler si un guard lo rechaza', async () => {
    const controller = createController();

    await assert.rejects(controller.closed(createTestContext()), ForbiddenException);
    assert.equal(controller.calls, 0);
  });

  it('se detiene en el primer guard que falla', async () => {
    const order: string[] = [];
    const first = () => {
      order.push('first');
      return false;
    };
    const second = () => {
      order.push('second');
      return true;
    };

    class OrderedController {
      @UseGuards(first, second)
      async handle(_ctx: HttpContext) {
        return 'ok';
      }
    }

    const controller = new Injector().instantiate(OrderedController);

    await assert.rejects(controller.handle(createTestContext()), ForbiddenException);
    assert.deepEqual(order, ['first']);
  });

  it('resuelve los guards de clase con el injector del controlador', async () => {
    const controller = createController();
    const asAdmin = createTestContext({ headers: { 'x-role': 'admin' } });
    const asCashier = createTestContext({ headers: { 'x-role': 'cashier' } });

    assert.equal(await controller.byRole(asAdmin), 'ok');
    await assert.rejects(controller.byRole(asCashier), ForbiddenException);
  });

  it('evalúa los guards antes que la validación', async () => {
    const controller = createController();

    await assert.rejects(
      controller.guardedAndValidated(createTestContext({ body: {} })),
      ForbiddenException
    );
  });

  it('exige que el controlador haya sido creado por el contenedor', async () => {
    await assert.rejects(
      new AdminController().open(createTestContext()),
      /AdminController was not created by the container/
    );
  });
});
