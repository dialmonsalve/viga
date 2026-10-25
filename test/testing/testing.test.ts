import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import {
  Controller,
  Get,
  Injectable,
  InjectionToken,
  Module,
  Post,
  Public,
  inject,
  type ApiErrorBody,
  type HttpContext,
  type OnModuleDestroy,
} from '../../src/index.ts';
import { CONFIG, ConfigModule } from '../../src/config/index.ts';
import { createTestingApp } from '../../src/testing/index.ts';
import { Validate } from '../../src/validation/index.ts';

const destroyed: string[] = [];

@Injectable()
class BooksRepository implements OnModuleDestroy {
  findAll() {
    return [{ id: 1, title: 'Real' }];
  }

  onModuleDestroy() {
    destroyed.push('repository');
  }
}

const GREETING = new InjectionToken<string>('GREETING');

const Book = z.strictObject({ title: z.string() });

@Controller('books')
class BooksController {
  private readonly books = inject(BooksRepository);
  private readonly greeting = inject(GREETING);

  @Public()
  @Get()
  list() {
    return this.books.findAll();
  }

  @Public()
  @Get('greeting')
  greet() {
    return { greeting: this.greeting };
  }

  @Public()
  @Get('text')
  text({ res }: HttpContext) {
    res.type('text/plain').send('hola');
  }

  @Post()
  @Validate({ body: Book })
  create({ body }: HttpContext<{ body: typeof Book }>) {
    return body;
  }
}

@Module({
  providers: [BooksRepository, { provide: GREETING, useValue: 'hola' }],
  controllers: [BooksController],
  exports: [BooksRepository],
})
class BooksModule {}

@Module({ imports: [BooksModule] })
class AppModule {}

describe('viga/testing', () => {
  it('arranca la app y hace peticiones con el body ya parseado', async () => {
    const app = await createTestingApp(AppModule);

    try {
      const { status, body, headers } = await app.request<{ id: number; title: string }[]>('/books');

      assert.equal(status, 200);
      assert.deepEqual(body, [{ id: 1, title: 'Real' }]);
      assert.match(headers.get('content-type') ?? '', /application\/json/);
    } finally {
      await app.close();
    }
  });

  it('reemplaza providers de módulos importados sin instanciar el original', async () => {
    destroyed.length = 0;
    const fake = { findAll: () => [{ id: 9, title: 'Falso' }] };
    const app = await createTestingApp(AppModule, {
      overrides: [
        { provide: BooksRepository, useValue: fake },
        { provide: GREETING, useValue: 'hello' },
      ],
    });

    try {
      assert.deepEqual((await app.request('/books')).body, [{ id: 9, title: 'Falso' }]);
      assert.deepEqual((await app.request('/books/greeting')).body, { greeting: 'hello' });
      assert.equal(app.get(BooksRepository), fake);
    } finally {
      await app.close();
    }
    assert.deepEqual(destroyed, []);
  });

  it('mantiene los valores por defecto de producción: rutas privadas sin guard responden 401', async () => {
    const app = await createTestingApp(AppModule);

    try {
      const response = await app.request<ApiErrorBody>('/books', { method: 'POST', json: { title: 'Dune' } });

      assert.equal(response.status, 401);
      assert.equal(response.body.code, 'errors.unauthorized');
    } finally {
      await app.close();
    }
  });

  it('configure permite añadir el guard de autenticación y otras opciones de la app', async () => {
    const app = await createTestingApp(AppModule, {
      globalPrefix: '/api',
      configure: (testing) => testing.useAuthGuard(({ req }) => req.headers.authorization === 'Bearer ok'),
    });

    try {
      const send = (authorization: string, json: unknown) =>
        app.request<ApiErrorBody>('/api/books', { method: 'POST', json, headers: { authorization } });

      assert.equal((await send('Bearer ok', { title: 'Dune' })).status, 201);
      assert.equal((await send('Bearer mal', { title: 'Dune' })).status, 401);
      const extra = await send('Bearer ok', { title: 'Dune', role: 'admin' });
      assert.equal(extra.body.code, 'errors.validation');
    } finally {
      await app.close();
    }
  });

  it('devuelve el texto tal cual cuando la respuesta no es JSON y expone la URL', async () => {
    const app = await createTestingApp(AppModule);

    try {
      const response = await app.request<string>('/books/text');
      assert.equal(response.status, 200);
      assert.equal(response.body, 'hola');

      const raw = await fetch(app.url('/books'));
      assert.equal(raw.status, 200);
      assert.match(app.url('/books'), /^http:\/\/127\.0\.0\.1:\d+\/books$/);
    } finally {
      await app.close();
    }
  });

  it('permite cambiar la configuración sin tocar process.env', async () => {
    const Env = z.object({ GREETING: z.string() });

    @Injectable()
    class Greeter {
      readonly config = inject(CONFIG) as unknown as { GREETING: string };
    }

    @Public()
    @Controller('config')
    class ConfigController {
      private readonly greeter = inject(Greeter);

      @Get()
      show() {
        return { greeting: this.greeter.config.GREETING };
      }
    }

    @Module({
      imports: [ConfigModule.forRoot({ schema: Env, env: {} })],
      providers: [Greeter],
      controllers: [ConfigController],
    })
    class ConfiguredModule {}

    const app = await createTestingApp(ConfiguredModule, {
      overrides: [{ provide: CONFIG, useValue: { GREETING: 'desde la prueba' } }],
    });

    try {
      assert.deepEqual((await app.request('/config')).body, { greeting: 'desde la prueba' });
      assert.equal(process.env.GREETING, undefined);
    } finally {
      await app.close();
    }
  });

  it('rechaza un override que no coincide con ningún provider', async () => {
    const UNKNOWN = new InjectionToken<string>('UNKNOWN');

    await assert.rejects(
      createTestingApp(AppModule, { overrides: [{ provide: UNKNOWN, useValue: 'x' }] }),
      /The override for InjectionToken\(UNKNOWN\) does not match any provider/
    );
  });
});
