import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Controller, Delete, Get, Module, Public, createApp, silentLogger, type AnyConstructor, type Logger } from '../../src/index.ts';
import { createTestingApp } from '../../src/testing/index.ts';

function appFor(...controllers: AnyConstructor[]) {
  @Module({ controllers })
  class AppModule {}

  return AppModule;
}

describe('orden de las rutas', () => {
  it('una ruta fija gana a un parámetro aunque se declare después', async () => {
    @Public()
    @Controller('/books')
    class BooksController {
      @Get('/:id')
      findOne() {
        return 'param';
      }

      @Get('/export')
      exportAll() {
        return 'fixed';
      }
    }

    const app = await createTestingApp(appFor(BooksController));

    assert.equal((await app.request('/books/export')).body, 'fixed');
    assert.equal((await app.request('/books/7')).body, 'param');
    await app.close();
  });

  it('ordena de más a menos específica, segmento a segmento', async () => {
    @Public()
    @Controller('/f')
    class FilesController {
      @Get('/*rest')
      wildcard() {
        return 'wildcard';
      }

      @Get('/:a/:b')
      twoParams() {
        return 'two params';
      }

      @Get('/:a/edit')
      paramThenFixed() {
        return 'param then fixed';
      }

      @Get('/new/:b')
      fixedThenParam() {
        return 'fixed then param';
      }

      @Get('/new/edit')
      allFixed() {
        return 'all fixed';
      }

      @Get('/report-:year')
      mixed() {
        return 'mixed';
      }

      @Get('/:a')
      oneParam() {
        return 'one param';
      }
    }

    const app = await createTestingApp(appFor(FilesController));

    for (const [path, expected] of [
      ['/f/new/edit', 'all fixed'],
      ['/f/new/x', 'fixed then param'],
      ['/f/x/edit', 'param then fixed'],
      ['/f/x/y', 'two params'],
      ['/f/report-2026', 'mixed'],
      ['/f/x', 'one param'],
      ['/f/x/y/z', 'wildcard'],
    ] as const) {
      assert.equal((await app.request(path)).body, expected, path);
    }
    await app.close();
  });

  it('entre rutas igual de específicas mantiene el orden de declaración', async () => {
    @Public()
    @Controller('/s')
    class SameController {
      @Get('/:a/one')
      one() {
        return 'one';
      }

      @Get('/:a/two')
      two() {
        return 'two';
      }
    }

    const app = await createTestingApp(appFor(SameController));

    assert.equal((await app.request('/s/x/one')).body, 'one');
    assert.equal((await app.request('/s/x/two')).body, 'two');
    await app.close();
  });

  it('no arranca con rutas que coinciden con las mismas peticiones', async () => {
    @Public()
    @Controller('/a')
    class ParamNames {
      @Get('/:id')
      byId() {}

      @Get('/:slug')
      bySlug() {}
    }

    @Public()
    @Controller('/b')
    class SamePath {
      @Get('/x')
      one() {}

      @Get('/x/')
      two() {}
    }

    @Public()
    @Controller('/c')
    class OtherCase {
      @Get('/Export')
      one() {}

      @Get('/export')
      two() {}
    }

    for (const controller of [ParamNames, SamePath, OtherCase]) {
      const app = createApp({ rootModule: appFor(controller), logger: silentLogger });
      await assert.rejects(app.init(), /match the same requests/, controller.name);
    }
  });

  it('detecta también duplicados entre controladores', async () => {
    @Public()
    @Controller('/books')
    class First {
      @Get('/:id')
      one() {}
    }

    @Public()
    @Controller('/books')
    class Second {
      @Get('/:slug')
      two() {}
    }

    const app = createApp({ rootModule: appFor(First, Second), logger: silentLogger });
    await assert.rejects(app.init(), /GET \/books\/:id and GET \/books\/:slug/);
  });

  it('la misma ruta con otro método no es un duplicado', async () => {
    @Public()
    @Controller('/m')
    class Methods {
      @Get('/:id')
      read() {
        return 'read';
      }

      @Delete('/:id')
      remove() {
        return 'removed';
      }
    }

    const app = await createTestingApp(appFor(Methods));

    assert.equal((await app.request('/m/1')).body, 'read');
    assert.equal((await app.request('/m/1', { method: 'DELETE' })).body, 'removed');
    await app.close();
  });

  describe('entre controladores', () => {
    function capturing() {
      const warnings: string[] = [];
      const logger: Logger = { ...silentLogger, warn: (message: unknown) => warnings.push(String(message)) };
      return { warnings, logger };
    }

    @Public()
    @Controller('/books')
    class ParamFirst {
      @Get('/:id')
      one() {
        return 'param';
      }
    }

    @Public()
    @Controller('/books')
    class FixedLater {
      @Get('/export')
      two() {
        return 'fixed';
      }
    }

    it('avisa de una ruta tapada por un controlador anterior', async () => {
      const { warnings, logger } = capturing();
      const app = await createTestingApp(appFor(ParamFirst, FixedLater), { logger });

      assert.equal(warnings.length, 1);
      assert.match(warnings[0] ?? '', /GET \/books\/export.*GET \/books\/:id/);
      assert.equal((await app.request('/books/export')).body, 'param');
      await app.close();
    });

    it('avisa también con un comodín', async () => {
      @Public()
      @Controller('/files')
      class Wildcard {
        @Get('/*rest')
        any() {}
      }

      @Public()
      @Controller('/files')
      class Deep {
        @Get('/a/b')
        deep() {}
      }

      const { warnings, logger } = capturing();
      const app = await createTestingApp(appFor(Wildcard, Deep), { logger });

      assert.equal(warnings.length, 1);
      await app.close();
    });

    it('no avisa si el orden es correcto o las rutas no se solapan', async () => {
      @Public()
      @Controller('/other')
      class Other {
        @Get('/:id')
        one() {}
      }

      @Public()
      @Controller('/books')
      class WithMethod {
        @Delete('/export')
        remove() {}
      }

      const { warnings, logger } = capturing();
      const app = await createTestingApp(appFor(FixedLater, ParamFirst, Other, WithMethod), { logger });

      assert.deepEqual(warnings, []);
      assert.equal((await app.request('/books/export')).body, 'fixed');
      await app.close();
    });
  });
});
