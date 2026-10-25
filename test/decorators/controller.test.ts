import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  readControllerDefinition,
} from '../../src/decorators/controller.ts';
import { Public } from '../../src/decorators/public.ts';

@Controller('/books')
class BooksController {
  @Get()
  list() {}

  @Get('/:id')
  findOne() {}

  @Post()
  @HttpCode(202)
  create() {}

  @Put('/:id')
  update() {}

  @Patch('/:id')
  patch() {}

  @Delete('/:id')
  remove() {}
}

describe('@Controller y decoradores de ruta', () => {
  it('registra el prefijo, las rutas y los códigos al declarar la clase', () => {
    const definition = readControllerDefinition(BooksController);

    assert.ok(definition);
    assert.equal(definition.prefix, '/books');
    assert.deepEqual(definition.routes, [
      { method: 'get', path: '', handlerName: 'list' },
      { method: 'get', path: '/:id', handlerName: 'findOne' },
      { method: 'post', path: '', handlerName: 'create' },
      { method: 'put', path: '/:id', handlerName: 'update' },
      { method: 'patch', path: '/:id', handlerName: 'patch' },
      { method: 'delete', path: '/:id', handlerName: 'remove' },
    ]);
    assert.deepEqual(definition.httpCodes, { create: 202 });
  });

  it('no duplica rutas al instanciar el controlador varias veces', () => {
    new BooksController();
    new BooksController();

    assert.equal(readControllerDefinition(BooksController)?.routes.length, 6);
  });

  it('devuelve undefined para clases sin @Controller()', () => {
    class Plain {
      @Get()
      list() {}
    }

    assert.equal(readControllerDefinition(Plain), undefined);
  });

  it('las subclases heredan rutas sin modificar las del padre', () => {
    @Controller('/base')
    class BaseController {
      @Get('/a')
      a() {}
    }

    @Controller('/child')
    class ChildController extends BaseController {
      @Get('/b')
      b() {}
    }

    const names = (target: typeof BaseController) =>
      readControllerDefinition(target)?.routes.map((route) => route.handlerName);

    assert.deepEqual(names(BaseController), ['a']);
    assert.deepEqual(names(ChildController), ['a', 'b']);
    assert.equal(readControllerDefinition(ChildController)?.prefix, '/child');
  });

  describe('@Public y herencia', () => {
    @Public()
    @Controller('/base')
    class PublicBase {
      @Get('/a')
      a() {}
    }

    @Controller('/base')
    class MixedBase {
      @Public()
      @Get('/open')
      open() {}

      @Public()
      @Get('/overridden')
      overridden() {}

      @Get('/closed')
      closed() {}
    }

    const publicOf = (target: abstract new (...args: any[]) => unknown) => {
      const definition = readControllerDefinition(target as new () => unknown);
      return {
        isPublic: definition?.isPublic,
        routes: Object.fromEntries(
          (definition?.routes ?? []).map((route) => [
            route.handlerName,
            definition?.publicRoutes[route.handlerName] === true,
          ])
        ),
      };
    };

    it('una subclase de un controlador @Public es privada si no repite @Public', () => {
      @Controller('/child')
      class Child extends PublicBase {}

      @Public()
      @Controller('/child')
      class PublicChild extends PublicBase {}

      assert.equal(publicOf(PublicBase).isPublic, true);
      assert.equal(publicOf(Child).isPublic, false);
      assert.equal(publicOf(PublicChild).isPublic, true);
    });

    it('un método sobrescrito deja de ser público salvo que repita @Public', () => {
      @Controller('/child')
      class Child extends MixedBase {
        override overridden() {}

        @Get('/extra')
        extra() {}
      }

      @Controller('/child')
      class ReDeclared extends MixedBase {
        @Public()
        override overridden() {}
      }

      assert.deepEqual(publicOf(Child).routes, {
        open: true,
        overridden: false,
        closed: false,
        extra: false,
      });
      assert.deepEqual(publicOf(ReDeclared).routes, { open: true, overridden: true, closed: false });
      assert.deepEqual(publicOf(MixedBase).routes, { open: true, overridden: true, closed: false });
    });

    it('una clase intermedia sin decoradores que sobrescribe el método también lo vuelve privado', () => {
      class Middle extends MixedBase {
        override open() {}
      }

      @Controller('/child')
      class Child extends Middle {}

      assert.equal(publicOf(Child).routes.open, false);
      assert.equal(publicOf(Child).routes.overridden, true);
    });

    it('una subclase sin decoradores no se trata como controlador con los datos del padre', () => {
      class Undecorated extends MixedBase {}

      assert.equal(readControllerDefinition(Undecorated), undefined);
    });
  });
});
