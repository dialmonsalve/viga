import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Post,
  Public,
  createApp,
  inject,
  silentLogger,
  type ApiErrorBody,
  type HttpContext,
} from '../../src/index.ts';
import { normalizePath } from '../../src/http/router.ts';
import { startTestServer, type TestServer } from '../helpers/http.ts';

@Injectable()
class BooksService {
  private readonly books = [{ id: 1, title: 'Dune' }];

  list() {
    return this.books;
  }

  find(id: number) {
    return this.books.find((book) => book.id === id);
  }
}

@Controller('/books')
class BooksController {
  private readonly books = inject(BooksService);

  @Get()
  list() {
    return this.books.list();
  }

  @Get('/manual')
  manual({ res }: HttpContext) {
    res.status(299).send('manual');
    return { ignored: true };
  }

  @Get('/boom')
  boom() {
    throw new Error('detalle interno que no debe salir');
  }

  @Get('/conflict')
  async conflict() {
    await Promise.resolve();
    throw new ConflictException('Ya existe');
  }

  @Get('/stable')
  stable() {
    throw new NotFoundException('books.notFound', { id: 7 });
  }

  @Get('/:id')
  findOne({ params }: HttpContext) {
    const book = this.books.find(Number(params.id));
    if (!book) throw new NotFoundException('Libro no encontrado');
    return book;
  }

  @Post()
  create({ body }: HttpContext) {
    return { id: 2, ...(body as object) };
  }

  @Post('/import')
  @HttpCode(202)
  importBooks() {
    return { queued: true };
  }

  @Delete('/:id')
  remove() {}
}

@Module({ controllers: [BooksController], providers: [BooksService] })
class BooksModule {}

describe('normalizePath', () => {
  it('añade la barra inicial y quita las repetidas o finales', () => {
    assert.equal(normalizePath(''), '/');
    assert.equal(normalizePath('books'), '/books');
    assert.equal(normalizePath('//books///'), '/books');
    assert.equal(normalizePath('/books/:id/'), '/books/:id');
  });
});

describe('errores al montar controladores', () => {
  it('exige @Controller() en los controladores de un módulo', async () => {
    class NotAController {}

    @Module({ controllers: [NotAController] })
    class BrokenModule {}

    const app = createApp({ rootModule: BrokenModule, logger: silentLogger });
    await assert.rejects(app.init(), /NotAController must be decorated with @Controller\(\)/);
  });

  it('exige que cada ruta sea un método', async () => {
    @Controller('broken')
    class BrokenController {
      @Get()
      list() {}
    }
    Object.defineProperty(BrokenController.prototype, 'list', { value: 'no soy un método' });

    @Module({ controllers: [BrokenController] })
    class BrokenModule {}

    const app = createApp({ rootModule: BrokenModule, logger: silentLogger });
    await assert.rejects(app.init(), /BrokenController\.list is not a method/);
  });
});

describe('mountController', () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer(BooksModule, { requireValidation: false });
  });

  after(() => server.close());

  it('responde 200 con el valor devuelto por el handler', async () => {
    const { status, body } = await server.request('/books');

    assert.equal(status, 200);
    assert.deepEqual(body, [{ id: 1, title: 'Dune' }]);
  });

  it('responde 201 por defecto en POST', async () => {
    const { status, body } = await server.request('/books', {
      method: 'POST',
      json: { title: 'Hyperion' },
    });

    assert.equal(status, 201);
    assert.deepEqual(body, { id: 2, title: 'Hyperion' });
  });

  it('respeta @HttpCode', async () => {
    const { status } = await server.request('/books/import', { method: 'POST' });

    assert.equal(status, 202);
  });

  it('responde 204 sin cuerpo cuando el handler no devuelve nada', async () => {
    const { status, body } = await server.request('/books/1', { method: 'DELETE' });

    assert.equal(status, 204);
    assert.equal(body, '');
  });

  it('no reescribe la respuesta si el handler ya la envió', async () => {
    const { status, body } = await server.request('/books/manual');

    assert.equal(status, 299);
    assert.equal(body, 'manual');
  });

  it('convierte las HttpException en respuestas de error', async () => {
    const { status, body } = await server.request<ApiErrorBody>('/books/99');

    assert.equal(status, 404);
    assert.equal(body.message, 'Libro no encontrado');
    assert.equal(body.error, 'Not Found');
    assert.equal(body.statusCode, 404);
    assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
  });

  it('responde 400 y no 500 cuando el JSON del cuerpo está mal formado', async () => {
    const { status, body } = await server.request<ApiErrorBody>('/books', {
      method: 'POST',
      body: '{"title":',
      headers: { 'content-type': 'application/json' },
    });

    assert.equal(status, 400);
    assert.equal(body.code, 'errors.badRequest');
  });

  it('captura errores de handlers async y el servidor sigue respondiendo', async () => {
    const conflict = await server.request<ApiErrorBody>('/books/conflict');
    const next = await server.request('/books');

    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.message, 'Ya existe');
    assert.equal(next.status, 200);
  });

  it('no expone el mensaje de errores inesperados', async () => {
    const { status, body } = await server.request<ApiErrorBody>('/books/boom');

    assert.equal(status, 500);
    assert.equal(body.message, 'An unexpected error occurred');
    assert.equal(body.code, 'errors.internal');
    assert.doesNotMatch(JSON.stringify(body), /detalle interno/);
  });

  it('responde 404 en rutas inexistentes con el mensaje por defecto', async () => {
    const { status, body } = await server.request<ApiErrorBody>('/nope');

    assert.equal(status, 404);
    assert.equal(body.code, 'errors.routeNotFound');
    assert.equal(body.message, 'The requested route does not exist');
  });

  it('asigna el código del estado HTTP cuando el mensaje es texto libre', async () => {
    const { body } = await server.request<ApiErrorBody>('/books/99');

    assert.equal(body.code, 'errors.notFound');
    assert.equal(body.message, 'Libro no encontrado');
  });
});

describe('resolveMessage', () => {
  let server: TestServer;
  const seen: string[] = [];

  before(async () => {
    server = await startTestServer(BooksModule, {
      requireValidation: false,
      resolveMessage: (code, params, req) => {
        seen.push(req.path);
        if (code === 'books.notFound') return `No existe el libro ${params?.id}`;
        if (code === 'errors.internal') return 'Algo salió mal';
        return undefined;
      },
    });
  });

  after(() => server.close());

  it('conserva el código y usa el mensaje que resuelve la app', async () => {
    const { body } = await server.request<ApiErrorBody>('/books/stable');

    assert.equal(body.code, 'books.notFound');
    assert.equal(body.message, 'No existe el libro 7');
    assert.ok(seen.includes('/books/stable'));
  });

  it('puede reemplazar los mensajes por defecto del framework', async () => {
    const { body } = await server.request<ApiErrorBody>('/books/boom');

    assert.equal(body.message, 'Algo salió mal');
  });

  it('usa el mensaje por defecto cuando la app no resuelve el código', async () => {
    const { body } = await server.request<ApiErrorBody>('/nope');

    assert.equal(body.message, 'The requested route does not exist');
  });
});

describe('errores después de empezar a responder', () => {
  @Public()
  @Controller('stream')
  class StreamController {
    @Get()
    async partial({ res }: HttpContext) {
      res.write('parcial');
      throw new Error('boom');
    }
  }

  @Module({ controllers: [StreamController] })
  class StreamModule {}

  it('registra el error una sola vez en el logger y corta la respuesta', async () => {
    const logged: unknown[] = [];
    const printed: unknown[] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => printed.push(args);

    const server = await startTestServer(StreamModule, {
      logger: { ...silentLogger, error: (_message, error) => logged.push(error) },
    });

    try {
      const response = await fetch(server.url('/stream'));
      await assert.rejects(response.text());
      await new Promise((resolve) => setTimeout(resolve, 20));

      assert.equal(logged.length, 1);
      assert.equal((logged[0] as Error).message, 'boom');
      assert.deepEqual(printed, []);
    } finally {
      console.error = consoleError;
      await server.close();
    }
  });
});
