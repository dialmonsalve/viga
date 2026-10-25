import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { z } from 'zod';
import { Controller, Get, Module, Public, type ApiErrorBody } from '../../src/index.ts';
import { Paginate, type PageContext, type PaginatedResult } from '../../src/pagination/index.ts';
import { Validate } from '../../src/validation/index.ts';
import { startTestServer, type TestServer } from '../helpers/http.ts';

interface Book {
  id: number;
  status: 'open' | 'closed';
}

const BOOKS: Book[] = Array.from({ length: 45 }, (_, i) => ({
  id: i + 1,
  status: i % 2 === 0 ? 'open' : 'closed',
}));

const Filter = z.object({ status: z.enum(['open', 'closed']).optional() });

@Public()
@Controller('books')
class BooksController {
  @Get()
  @Paginate()
  list({ page }: PageContext): PaginatedResult<Book> {
    return page.result(BOOKS.slice(page.offset, page.offset + page.limit), BOOKS.length);
  }

  @Get('shallow')
  @Paginate({ maxOffset: 40 })
  shallow({ page }: PageContext) {
    return page.result([], BOOKS.length);
  }

  @Get('filtered')
  @Paginate({ defaultLimit: 5, maxLimit: 10, maxPage: 50 })
  @Validate({ query: Filter })
  filtered({ page, query }: PageContext<{ query: typeof Filter }>) {
    const matching = BOOKS.filter((book) => !query.status || book.status === query.status);
    return page.result(matching.slice(page.offset, page.offset + page.limit), matching.length);
  }
}

@Module({ controllers: [BooksController] })
class BooksModule {}

describe('@Paginate', () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer(BooksModule, { globalPrefix: '/api' });
  });

  after(() => server.close());

  it('sin parámetros usa la página 1 y el límite por defecto', async () => {
    const { status, body } = await server.request<PaginatedResult<Book>>('/api/books');

    assert.equal(status, 200);
    assert.equal(body.data.length, 20);
    assert.equal(body.data[0]?.id, 1);
    assert.deepEqual(body.meta, {
      total: 45,
      page: 1,
      lastPage: 3,
      next: '/api/books?page=2&limit=20',
      prev: null,
    });
  });

  it('en la última página no hay next y prev apunta a la anterior', async () => {
    const { body } = await server.request<PaginatedResult<Book>>('/api/books?page=3');

    assert.deepEqual(
      body.data.map((book) => book.id),
      [41, 42, 43, 44, 45]
    );
    assert.equal(body.meta.next, null);
    assert.equal(body.meta.prev, '/api/books?page=2&limit=20');
  });

  it('más allá de la última página devuelve vacío y prev apunta a la última', async () => {
    const { body } = await server.request<PaginatedResult<Book>>('/api/books?page=9');

    assert.deepEqual(body.data, []);
    assert.equal(body.meta.next, null);
    assert.equal(body.meta.prev, '/api/books?page=3&limit=20');
  });

  it('recorta el límite a maxLimit', async () => {
    const { body } = await server.request<PaginatedResult<Book>>('/api/books?limit=100000');

    assert.equal(body.data.length, 45);
    assert.equal(body.meta.lastPage, 1);

    const capped = await server.request<PaginatedResult<Book>>('/api/books/filtered?limit=999');
    assert.equal(capped.body.data.length, 10);
    assert.equal(capped.body.meta.next, '/api/books/filtered?limit=10&page=2');
  });

  it('conserva los filtros en los enlaces y combina con @Validate', async () => {
    const { body } = await server.request<PaginatedResult<Book>>(
      '/api/books/filtered?status=open&page=2'
    );

    assert.ok(body.data.every((book) => book.status === 'open'));
    assert.equal(body.meta.total, 23);
    assert.equal(body.meta.next, '/api/books/filtered?status=open&page=3&limit=5');
    assert.equal(body.meta.prev, '/api/books/filtered?status=open&page=1&limit=5');
  });

  for (const query of ['page=0', 'page=abc', 'page=1.5', 'page=-1', 'page=1&page=2', 'page=51']) {
    it(`responde 400 con un page inválido: ${query}`, async () => {
      const { status, body } = await server.request<ApiErrorBody>(`/api/books/filtered?${query}`);

      assert.equal(status, 400);
      assert.equal(body.code, 'errors.invalidPage');
      assert.equal(body.message, 'page must be an integer between 1 and 50');
    });
  }

  for (const query of ['limit=0', 'limit=-5', 'limit=2.5', 'limit=x']) {
    it(`responde 400 con un limit inválido: ${query}`, async () => {
      const { status, body } = await server.request<ApiErrorBody>(`/api/books?${query}`);

      assert.equal(status, 400);
      assert.equal(body.code, 'errors.invalidLimit');
    });
  }

  const rawGet = (path: string, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; next?: string | null }>((resolve, reject) => {
      const { port } = new URL(server.url('/'));
      const req = httpRequest(
        { host: '127.0.0.1', port, path, agent: false, headers },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (text += chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, next: JSON.parse(text).meta?.next })
          );
        }
      );
      req.on('error', reject);
      req.end();
    });

  it('los enlaces son relativos aunque el cliente envíe otra cabecera Host', async () => {
    const { next } = await rawGet('/api/books', { host: 'evil.example' });

    assert.equal(next, '/api/books?page=2&limit=20');
  });

  it('ninguna ruta manipulada genera un enlace a otro dominio', async () => {
    assert.equal((await rawGet('//evil.example/api/books')).status, 404);
    assert.equal((await rawGet('/api//books')).status, 404);
    assert.equal(
      (await rawGet('/api/books?x=%2F%2Fevil.example')).next,
      '/api/books?x=%2F%2Fevil.example&page=2&limit=20'
    );
    assert.equal((await rawGet('/api/books/')).next, '/api/books?page=2&limit=20');
  });

  it('por defecto limita el OFFSET a 10.000 filas según el limit pedido', async () => {
    assert.equal((await server.request('/api/books?page=101&limit=100')).status, 200);
    assert.equal((await server.request('/api/books?page=501')).status, 200);

    const deep = await server.request<ApiErrorBody>('/api/books?page=102&limit=100');
    assert.equal(deep.status, 400);
    assert.equal(deep.body.code, 'errors.invalidPage');
    assert.equal(deep.body.message, 'page must be an integer between 1 and 101');
    assert.equal((await server.request('/api/books?page=502')).status, 400);
  });

  it('maxOffset cambia la profundidad permitida', async () => {
    assert.equal((await server.request('/api/books/shallow?page=3')).status, 200);
    const deep = await server.request<ApiErrorBody>('/api/books/shallow?page=4');

    assert.equal(deep.status, 400);
    assert.equal(deep.body.message, 'page must be an integer between 1 and 3');
  });

  it('rechaza opciones inválidas al declarar el decorador', () => {
    assert.throws(() => Paginate({ maxOffset: -1 }), /must be positive integers/);
    assert.throws(() => Paginate({ defaultLimit: 50, maxLimit: 10 }), /defaultLimit cannot exceed maxLimit/);
    assert.throws(() => Paginate({ maxPage: 0 }), /must be positive integers/);
  });
});
