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
});
