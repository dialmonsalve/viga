import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Validator } from '@seriousme/openapi-schema-validator';
import { toStandardJsonSchema } from '@valibot/to-json-schema';
import { type } from 'arktype';
import * as v from 'valibot';
import { z } from 'zod';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  Post,
  Public,
  RateLimit,
  UseGuards,
  inject,
  silentLogger,
  type AnyConstructor,
  type Logger,
} from '../../src/index.ts';
import { CONFIG, ConfigModule } from '../../src/config/index.ts';
import {
  Docs,
  OpenApiModule,
  OpenApiService,
  type OpenApiDocument,
  type OpenApiOptions,
  type OpenApiRoutes,
} from '../../src/openapi/index.ts';
import { createTestingApp, type TestingAppOptions } from '../../src/testing/index.ts';
import { Upload } from '../../src/upload/index.ts';
import { Validate } from '../../src/validation/index.ts';

const INFO: OpenApiOptions = { title: 'API', version: '1.0.0' };

function capturingLogger() {
  const warnings: string[] = [];
  const logger: Logger = { ...silentLogger, warn: (message: string) => warnings.push(message) };
  return { warnings, logger };
}

async function documentOf(
  controllers: AnyConstructor[],
  appOptions: TestingAppOptions = {},
  options: OpenApiOptions = INFO
) {
  @Module({ imports: [OpenApiModule.forRoot(options, { public: true })], controllers })
  class AppModule {}

  const app = await createTestingApp(AppModule, appOptions);
  try {
    return app.get(OpenApiService).document();
  } finally {
    await app.close();
  }
}

function operation(document: OpenApiDocument, path: string, method: string) {
  const found = document.paths[path]?.[method];
  assert.ok(found, `falta ${method} ${path}`);
  return JSON.parse(JSON.stringify(found));
}

async function assertValid(document: OpenApiDocument) {
  const result = await new Validator().validate(JSON.parse(JSON.stringify(document)));
  assert.deepEqual(result.errors, undefined);
  assert.equal(result.valid, true);
}

describe('viga/openapi', () => {
  describe('la ruta del documento', () => {
    @Public()
    @Controller('/books')
    class BooksController {
      @Get()
      list() {
        return [];
      }
    }

    async function start(routes?: OpenApiRoutes, appOptions?: TestingAppOptions) {
      @Module({ imports: [OpenApiModule.forRoot(INFO, routes)], controllers: [BooksController] })
      class AppModule {}

      return createTestingApp(AppModule, { logger: silentLogger, ...appOptions });
    }

    it('es privada por defecto', async () => {
      const app = await start();
      const { status } = await app.request('/openapi.json');
      await app.close();

      assert.equal(status, 401);
    });

    it('se abre con public: true', async () => {
      const app = await start({ public: true });
      const { status, body } = await app.request<OpenApiDocument>('/openapi.json');
      await app.close();

      assert.equal(status, 200);
      assert.equal(body.openapi, '3.1.0');
      assert.deepEqual(body.info, INFO);
    });

    it('pasa por el guard de autenticación si es privada', async () => {
      const app = await start(undefined, {
        configure: (testing) => testing.useAuthGuard(({ req }) => req.headers.authorization === 'Bearer ok'),
      });

      const denied = await app.request('/openapi.json');
      const allowed = await app.request('/openapi.json', { headers: { authorization: 'Bearer ok' } });
      await app.close();

      assert.equal(denied.status, 401);
      assert.equal(allowed.status, 200);
    });

    it('acepta otra ruta y lleva el prefijo global', async () => {
      const app = await start({ path: '/docs.json', public: true }, { globalPrefix: '/api' });
      const { status, body } = await app.request<OpenApiDocument>('/api/docs.json');
      await app.close();

      assert.equal(status, 200);
      assert.ok(body.paths['/api/books']);
    });

    it('no aparece en el propio documento', async () => {
      const document = await documentOf([BooksController]);
      assert.deepEqual(Object.keys(document.paths), ['/books']);
    });

    it('forRoot acepta una función que usa inject()', async () => {
      const Env = z.object({ NODE_ENV: z.string() });

      @Module({
        imports: [
          ConfigModule.forRoot({ schema: Env, env: { NODE_ENV: 'desde config' } }),
          OpenApiModule.forRoot(() => ({ title: String(inject(CONFIG).NODE_ENV), version: '1' }), { public: true }),
        ],
      })
      class AppModule {}

      const app = await createTestingApp(AppModule);
      const { body } = await app.request<OpenApiDocument>('/openapi.json');
      await app.close();

      assert.equal(body.info.title, 'desde config');
    });
  });

  describe('lo que sale de los decoradores', () => {
    const Book = z.object({ id: z.number().int(), title: z.string() });
    const CreateBook = z.strictObject({ title: z.string().min(1) });
    const BookParams = z.object({ id: z.coerce.number().int().positive() });
    const ListBooks = z.object({ page: z.coerce.number().int().default(1), search: z.string(), tag: z.string().optional() });

    @Controller('/books')
    class BooksController {
      @Public()
      @Get()
      @Validate({ query: ListBooks })
      list() {
        return [];
      }

      @Get('/:id')
      @Docs({ summary: 'Devuelve un libro', description: 'Más detalle', responses: { 200: Book, 404: 'No existe' } })
      @Validate({ params: BookParams })
      findOne() {
        return {};
      }

      @Post()
      @Validate({ body: CreateBook })
      create() {
        return {};
      }

      @Delete('/:id')
      @HttpCode(204)
      remove() {
        return undefined;
      }
    }

    it('genera un documento OpenAPI 3.1 válido', async () => {
      await assertValid(await documentOf([BooksController]));
    });

    it('convierte las rutas y lleva el prefijo global', async () => {
      const document = await documentOf([BooksController], { globalPrefix: '/api' });
      assert.deepEqual(Object.keys(document.paths).sort(), ['/api/books', '/api/books/{id}']);
    });

    it('lee los parámetros de @Validate, y una default no es obligatoria', async () => {
      const document = await documentOf([BooksController]);

      const list = operation(document, '/books', 'get');
      assert.deepEqual(
        list.parameters.map((parameter: { name: string; in: string; required: boolean }) => [parameter.name, parameter.in, parameter.required]),
        [['page', 'query', false], ['search', 'query', true], ['tag', 'query', false]]
      );

      const [id] = operation(document, '/books/{id}', 'get').parameters;
      assert.equal(id.in, 'path');
      assert.equal(id.required, true);
      assert.equal(id.schema.type, 'integer');
    });

    it('un parámetro de ruta sin esquema se documenta como texto', async () => {
      const document = await documentOf([BooksController]);
      const [id] = operation(document, '/books/{id}', 'delete').parameters;
      assert.deepEqual(id.schema, { type: 'string' });
    });

    it('lee el cuerpo de @Validate', async () => {
      const document = await documentOf([BooksController]);
      const { requestBody } = operation(document, '/books', 'post');

      assert.equal(requestBody.required, true);
      assert.deepEqual(requestBody.content['application/json'].schema, {
        type: 'object',
        properties: { title: { type: 'string', minLength: 1 } },
        required: ['title'],
        additionalProperties: false,
      });
    });

    it('calcula los códigos de respuesta', async () => {
      const document = await documentOf([BooksController]);
      const codes = (path: string, method: string) => Object.keys(operation(document, path, method).responses).sort();

      assert.deepEqual(codes('/books', 'get'), ['200', '400']);
      assert.deepEqual(codes('/books', 'post'), ['201', '400', '401']);
      assert.deepEqual(codes('/books/{id}', 'delete'), ['204', '401']);
      assert.deepEqual(codes('/books/{id}', 'get'), ['200', '400', '401', '404']);
    });

    it('@Docs añade textos y respuestas, y un error en texto usa el formato de viga', async () => {
      const document = await documentOf([BooksController]);
      const found = operation(document, '/books/{id}', 'get');

      assert.equal(found.summary, 'Devuelve un libro');
      assert.equal(found.description, 'Más detalle');
      assert.equal(found.responses[200].content['application/json'].schema.properties.title.type, 'string');
      assert.equal(found.responses[404].description, 'No existe');
      assert.deepEqual(found.responses[404].content['application/json'].schema, { $ref: '#/components/schemas/ApiError' });
    });

    it('agrupa por el nombre del controlador', async () => {
      const document = await documentOf([BooksController]);
      assert.deepEqual(operation(document, '/books', 'get').tags, ['Books']);
    });

    it('marca seguridad solo si declaras securitySchemes', async () => {
      const options: OpenApiOptions = { ...INFO, securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } };
      const withSchemes = await documentOf([BooksController], {}, options);
      const without = await documentOf([BooksController]);

      assert.deepEqual(operation(withSchemes, '/books', 'post').security, [{ bearerAuth: [] }]);
      assert.deepEqual(operation(withSchemes, '/books', 'get').security, []);
      assert.deepEqual(withSchemes.components.securitySchemes, options.securitySchemes);
      assert.equal(operation(without, '/books', 'post').security, undefined);
      await assertValid(withSchemes);
    });

    it('incluye la descripción general', async () => {
      const document = await documentOf([], {}, { ...INFO, description: 'Mi API' });
      assert.equal(document.info.description, 'Mi API');
    });
  });

  describe('@Docs sobre la clase', () => {
    @Public()
    @Docs({ tags: ['Inventario'], deprecated: true })
    @Controller('/stock')
    class StockController {
      @Get()
      list() {
        return [];
      }

      @Get('/nuevo')
      @Docs({ tags: ['Otro'], deprecated: false })
      latest() {
        return [];
      }

      @Get('/interno')
      @Docs({ hidden: true })
      secret() {
        return [];
      }
    }

    @Public()
    @Docs({ hidden: true })
    @Controller('/admin')
    class AdminController {
      @Get()
      list() {
        return [];
      }
    }

    it('aplica tags y deprecated a sus rutas, y el método manda', async () => {
      const document = await documentOf([StockController]);

      assert.deepEqual(operation(document, '/stock', 'get').tags, ['Inventario']);
      assert.equal(operation(document, '/stock', 'get').deprecated, true);
      assert.deepEqual(operation(document, '/stock/nuevo', 'get').tags, ['Otro']);
      assert.equal(operation(document, '/stock/nuevo', 'get').deprecated, undefined);
    });

    it('hidden oculta una ruta o un controlador entero, sin quitarlos de la app', async () => {
      @Module({ imports: [OpenApiModule.forRoot(INFO, { public: true })], controllers: [StockController, AdminController] })
      class AppModule {}

      const app = await createTestingApp(AppModule);
      const { body } = await app.request<OpenApiDocument>('/openapi.json');
      const hidden = await app.request('/admin');
      await app.close();

      assert.deepEqual(Object.keys(body.paths).sort(), ['/stock', '/stock/nuevo']);
      assert.equal(hidden.status, 200);
    });
  });

  describe('otras librerías de validación', () => {
    const fromArktype = type({ sku: 'string > 0', qty: 'number.integer > 0' });
    const fromValibot = toStandardJsonSchema(v.object({ name: v.pipe(v.string(), v.minLength(1)) }));

    @Public()
    @Controller()
    class SchemasController {
      @Post('/arktype')
      @Validate({ body: fromArktype })
      arktype() {
        return {};
      }

      @Post('/valibot')
      @Validate({ body: fromValibot })
      valibot() {
        return {};
      }
    }

    const body = (document: OpenApiDocument, path: string) =>
      operation(document, path, 'post').requestBody.content['application/json'].schema;

    it('convierte ArkType', async () => {
      const document = await documentOf([SchemasController]);
      assert.equal(body(document, '/arktype').properties.qty.type, 'integer');
    });

    it('convierte Valibot envuelto con toStandardJsonSchema', async () => {
      const document = await documentOf([SchemasController]);
      assert.deepEqual(body(document, '/valibot').properties.name, { type: 'string', minLength: 1 });
    });
  });

  describe('lo que no se puede convertir', () => {
    const plain = v.object({ name: v.string() });
    const withDate = z.object({ when: z.date() });
    const withTransform = z.object({ title: z.string().transform((value) => value.trim()) });
    const query = z.object({ tag: z.string().transform((value) => value.trim()) });

    @Public()
    @Controller()
    class EdgeController {
      @Post('/plano')
      @Validate({ body: plain })
      plain() {
        return {};
      }

      @Post('/fecha')
      @Validate({ body: withDate })
      date() {
        return {};
      }

      @Get('/respuesta')
      @Docs({ responses: { 200: withTransform } })
      response() {
        return {};
      }

      @Get('/query')
      @Validate({ query })
      query() {
        return {};
      }
    }

    it('no impide arrancar: esa parte queda sin detallar y el documento sigue siendo válido', async () => {
      const { logger } = capturingLogger();
      const document = await documentOf([EdgeController], { logger });

      assert.deepEqual(operation(document, '/plano', 'post').requestBody.content['application/json'].schema, {});
      assert.deepEqual(operation(document, '/fecha', 'post').requestBody.content['application/json'].schema, {});
      await assertValid(document);
    });

    it('avisa en el log una sola vez, diciendo qué ruta y por qué', async () => {
      const { logger, warnings } = capturingLogger();

      @Module({ imports: [OpenApiModule.forRoot(INFO, { public: true })], controllers: [EdgeController] })
      class AppModule {}

      const app = await createTestingApp(AppModule, { logger });
      await app.request('/openapi.json');
      await app.request('/openapi.json');
      await app.close();

      assert.equal(warnings.filter((warning) => warning.startsWith('[OpenApi]')).length, 2);
      assert.ok(warnings.some((warning) => warning.includes('POST /plano body') && warning.includes('~standard.jsonSchema')));
      assert.ok(warnings.some((warning) => warning.includes('POST /fecha body') && warning.includes('Date cannot be represented')));
    });

    it('con transform usa el otro lado del esquema', async () => {
      const document = await documentOf([EdgeController]);

      assert.equal(operation(document, '/respuesta', 'get').responses[200].content['application/json'].schema.properties.title.type, 'string');
      assert.equal(operation(document, '/query', 'get').parameters[0].schema.type, 'string');
    });
  });

  describe('@RateLimit y @Upload', () => {
    const limit = { max: 5, windowMs: 60_000 };
    const fields = z.object({ title: z.string() });

    @Public()
    @RateLimit(limit)
    @Controller('/limited')
    class LimitedController {
      @Get()
      list() {
        return [];
      }
    }

    @Public()
    @Controller('/files')
    class FilesController {
      @Post()
      @RateLimit(limit)
      @Upload({ field: 'photo', types: ['image/png'] })
      @Validate({ body: fields })
      single() {
        return {};
      }

      @Post('/many')
      @Upload({ field: 'photos', types: ['image/png'], maxFiles: 3, optional: true })
      many() {
        return {};
      }

      @Get('/guarded')
      @UseGuards(() => true)
      guarded() {
        return {};
      }
    }

    it('añade 429 con el decorador en la clase o en el método, y no con otro guard', async () => {
      const document = await documentOf([LimitedController, FilesController]);

      assert.ok(operation(document, '/limited', 'get').responses[429]);
      assert.ok(operation(document, '/files', 'post').responses[429]);
      assert.equal(operation(document, '/files/guarded', 'get').responses[429], undefined);
      await assertValid(document);
    });

    it('documenta el archivo y los campos del formulario como multipart', async () => {
      const document = await documentOf([FilesController]);
      const { requestBody, responses } = operation(document, '/files', 'post');
      const schema = requestBody.content['multipart/form-data'].schema;

      assert.equal(requestBody.required, true);
      assert.deepEqual(schema.properties.photo, { type: 'string', format: 'binary' });
      assert.deepEqual(schema.properties.title, { type: 'string' });
      assert.deepEqual(schema.required.sort(), ['photo', 'title']);
      assert.ok(responses[400] && responses[413] && responses[415]);
    });

    it('varios archivos son una lista, y optional no los exige', async () => {
      const document = await documentOf([FilesController]);
      const { requestBody } = operation(document, '/files/many', 'post');
      const schema = requestBody.content['multipart/form-data'].schema;

      assert.equal(requestBody.required, false);
      assert.deepEqual(schema.properties.photos, { type: 'array', items: { type: 'string', format: 'binary' } });
      assert.equal(schema.required, undefined);
    });
  });

  describe('casos especiales', () => {
    it('convierte comodines y grupos opcionales de Express', async () => {
      @Public()
      @Controller('/files')
      class WildController {
        @Get('/*path')
        all() {
          return {};
        }

        @Get('/by/:year{/:month}')
        optional() {
          return {};
        }
      }

      const document = await documentOf([WildController]);
      assert.ok(document.paths['/files/{path}']);
      assert.ok(document.paths['/files/by/{year}/{month}']);
      await assertValid(document);
    });

    it('dos controladores con el mismo nombre no repiten operationId', async () => {
      function make(prefix: string) {
        @Public()
        @Controller(prefix)
        class ItemsController {
          @Get()
          list() {
            return [];
          }
        }
        return ItemsController;
      }

      const document = await documentOf([make('/a'), make('/b')]);
      assert.notEqual(operation(document, '/a', 'get').operationId, operation(document, '/b', 'get').operationId);
      await assertValid(document);
    });

    it('incluye las rutas de los módulos importados y conviven métodos en una ruta', async () => {
      @Public()
      @Controller('/nested')
      class NestedController {
        @Get()
        list() {
          return [];
        }

        @Post()
        create() {
          return {};
        }
      }

      @Module({ controllers: [NestedController] })
      class NestedModule {}

      @Module({ imports: [NestedModule, OpenApiModule.forRoot(INFO, { public: true })] })
      class AppModule {}

      const app = await createTestingApp(AppModule);
      const { body } = await app.request<OpenApiDocument>('/openapi.json');
      await app.close();

      assert.deepEqual(Object.keys(body.paths['/nested'] ?? {}).sort(), ['get', 'post']);
    });

    it('OpenApiService se puede inyectar en un provider de la app', async () => {
      @Injectable()
      class Exporter {
        private readonly openApi = inject(OpenApiService);
        title() {
          return this.openApi.document().info.title;
        }
      }

      @Module({ imports: [OpenApiModule.forRoot(INFO)], providers: [Exporter], exports: [Exporter] })
      class AppModule {}

      const app = await createTestingApp(AppModule, { logger: silentLogger });
      const title = app.get(Exporter).title();
      await app.close();

      assert.equal(title, 'API');
    });
  });
});
