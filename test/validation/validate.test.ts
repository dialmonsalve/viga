import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { z } from 'zod';
import {
  BadRequestException,
  Controller,
  Injector,
  Module,
  Post,
  type ApiErrorBody,
  type HttpContext,
  type StandardSchemaV1,
} from '../../src/index.ts';
import {
  VALIDATION_OPTIONS,
  Validate,
  ValidationModule,
  type ValidationErrors,
} from '../../src/validation/index.ts';
import { createTestContext } from '../helpers/context.ts';
import { startTestServer, type TestServer } from '../helpers/http.ts';

const BookBody = z.object({
  title: z.string().min(1),
  price: z.number().positive(),
});

const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

class BooksHandler {
  calls = 0;

  @Validate({ body: BookBody, query: PageQuery })
  create(ctx: HttpContext<{ body: typeof BookBody; query: typeof PageQuery }>) {
    this.calls++;
    return { body: ctx.body, query: ctx.query };
  }
}

function detailsOf(error: unknown): ValidationErrors {
  assert.ok(error instanceof BadRequestException);
  assert.equal(error.code, 'errors.validation');
  return error.details as ValidationErrors;
}

const Slug: StandardSchemaV1<unknown, string> = {
  '~standard': {
    version: 1,
    vendor: 'manual',
    validate: async (value) =>
      typeof value === 'string' && /^[a-z-]+$/.test(value)
        ? { value: value.toUpperCase() }
        : { issues: [{ message: 'slug inválido', path: [{ key: 'slug' }] }] },
  },
};

class SlugHandler {
  @Validate({ params: Slug })
  read({ params }: HttpContext<{ params: typeof Slug }>) {
    return params;
  }
}

describe('@Validate', () => {
  it('entrega al handler los datos ya parseados', async () => {
    const handler = new BooksHandler();
    const result = await handler.create(
      createTestContext({
        body: { title: 'Dune', price: 20, internal: true },
        query: { page: '3' },
      }) as never
    );

    assert.deepEqual(result, { body: { title: 'Dune', price: 20 }, query: { page: 3 } });
  });

  it('aplica los valores por defecto del schema', async () => {
    const handler = new BooksHandler();
    const result = await handler.create(
      createTestContext({ body: { title: 'Dune', price: 20 } }) as never
    );

    assert.deepEqual(result.query, { page: 1 });
  });

  it('lanza BadRequestException con el detalle por campo y no ejecuta el handler', async () => {
    const handler = new BooksHandler();

    await assert.rejects(
      async () => handler.create(createTestContext({ body: { title: '', price: -1 } }) as never),
      (error: unknown) => {
        const details = detailsOf(error);
        assert.deepEqual(Object.keys(details), ['body']);
        assert.deepEqual(
          details.body?.map((issue) => [issue.path, issue.code]),
          [
            ['title', 'too_small'],
            ['price', 'too_small'],
          ]
        );
        return true;
      }
    );
    assert.equal(handler.calls, 0);
  });

  it('reporta a la vez los errores de varias partes de la petición', async () => {
    const handler = new BooksHandler();

    await assert.rejects(
      async () => handler.create(createTestContext({ body: {}, query: { page: 'cero' } }) as never),
      (error: unknown) => {
        assert.deepEqual(Object.keys(detailsOf(error)), ['body', 'query']);
        return true;
      }
    );
  });

  it('acepta cualquier implementación de Standard Schema, incluso asíncrona', async () => {
    const handler = new SlugHandler();

    assert.equal(await handler.read(createTestContext({ params: 'mi-libro' as never })), 'MI-LIBRO');
    await assert.rejects(
      async () => handler.read(createTestContext({ params: 'No Válido' as never })),
      (error: unknown) => {
        assert.deepEqual(detailsOf(error).params, [{ path: 'slug', message: 'slug inválido' }]);
        return true;
      }
    );
  });

  it('usa el formatIssue registrado en el contenedor', async () => {
    const injector = new Injector([
      { provide: VALIDATION_OPTIONS, useValue: { formatIssue: () => 'mensaje propio' } },
    ]);
    const handler = injector.instantiate(SlugHandler);

    await assert.rejects(
      async () => handler.read(createTestContext({ params: '!' as never })),
      (error: unknown) => {
        assert.equal(detailsOf(error).params?.[0]?.message, 'mensaje propio');
        return true;
      }
    );
  });
});

const CreateBook = z.object({ title: z.string().min(1) });

@Controller('/books')
class BooksController {
  @Post()
  @Validate({ body: CreateBook })
  create({ body }: HttpContext<{ body: typeof CreateBook }>) {
    return body;
  }
}

@Module({ controllers: [BooksController] })
class BooksModule {}

describe('ValidationModule', () => {
  let server: TestServer;

  before(async () => {
    @Module({
      imports: [
        ValidationModule.forRoot({ formatIssue: (issue) => `[${issue.message}]` }),
        BooksModule,
      ],
    })
    class AppModule {}

    server = await startTestServer(AppModule);
  });

  after(() => server.close());

  it('responde 400 con el detalle y aplica formatIssue a todos los módulos', async () => {
    const { status, body } = await server.request<ApiErrorBody>('/books', {
      method: 'POST',
      json: { title: '' },
    });
    const issue = (body.details as ValidationErrors).body?.[0];

    assert.equal(status, 400);
    assert.equal(body.code, 'errors.validation');
    assert.equal(body.message, 'Invalid input data');
    assert.equal(issue?.path, 'title');
    assert.match(issue?.message ?? '', /^\[.+\]$/);
  });
});
