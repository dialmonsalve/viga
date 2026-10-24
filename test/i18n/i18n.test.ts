import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { z } from 'zod';
import {
  Controller,
  Get,
  Module,
  NotFoundException,
  Post,
  type ApiErrorBody,
  type HttpContext,
} from '../../src/index.ts';
import { I18n, currentLocale, negotiateLocale, runWithLocale } from '../../src/i18n/index.ts';
import { Validate, ValidationModule, type ValidationErrors } from '../../src/validation/index.ts';
import { startTestServer, type TestServer } from '../helpers/http.ts';

describe('negotiateLocale', () => {
  const supported = ['es', 'en'];

  it('elige el idioma soportado con mayor prioridad', () => {
    assert.equal(negotiateLocale('fr-FR,en;q=0.8,es;q=0.9', supported, 'es'), 'es');
    assert.equal(negotiateLocale('en-GB', supported, 'es'), 'en');
  });

  it('usa el idioma por defecto si ninguno coincide o no hay cabecera', () => {
    assert.equal(negotiateLocale('fr,de', supported, 'es'), 'es');
    assert.equal(negotiateLocale(undefined, supported, 'en'), 'en');
    assert.equal(negotiateLocale('*', supported, 'es'), 'es');
  });

  it('ignora los idiomas con q=0', () => {
    assert.equal(negotiateLocale('en;q=0,es', supported, 'en'), 'es');
  });
});

const i18n = new I18n({
  defaultLocale: 'es',
  catalogs: {
    es: { books: { notFound: 'No existe el libro {id}' }, errors: { forbidden: 'Prohibido' } },
    en: { books: { notFound: 'Book {id} does not exist' } },
  },
});

describe('I18n', () => {
  it('traduce claves de la app con parámetros', () => {
    assert.equal(i18n.translate('en', 'books.notFound', { id: 7 }), 'Book 7 does not exist');
    assert.equal(i18n.translate('es', 'books.notFound', { id: 7 }), 'No existe el libro 7');
  });

  it('permite reemplazar los mensajes del framework', () => {
    assert.equal(i18n.translate('es', 'errors.forbidden'), 'Prohibido');
    assert.equal(i18n.translate('en', 'errors.forbidden'), 'You are not allowed to perform this action');
  });

  it('trae en español e inglés los mensajes del framework', () => {
    assert.equal(i18n.translate('es', 'errors.notFound'), 'El recurso solicitado no existe');
    assert.equal(i18n.translate('en', 'errors.validation'), 'Invalid input data');
  });

  it('cae al idioma por defecto y luego a la clave', () => {
    const partial = new I18n({ defaultLocale: 'es', catalogs: { es: { only: 'solo es' }, en: {} } });

    assert.equal(partial.translate('en', 'only'), 'solo es');
    assert.equal(partial.translate('en', 'texto libre'), 'texto libre');
  });

  it('no confunde propiedades heredadas con claves', () => {
    assert.equal(i18n.has('toString'), false);
    assert.equal(i18n.translate('es', 'books.constructor'), 'books.constructor');
  });

  it('sin configuración ofrece inglés y español, con inglés por defecto', () => {
    const fallback = new I18n();

    assert.deepEqual(fallback.locales, ['en', 'es']);
    assert.equal(fallback.defaultLocale, 'en');
  });

  it('exige que el idioma por defecto tenga catálogo', () => {
    assert.throws(() => new I18n({ defaultLocale: 'fr', catalogs: { es: {} } }), /"fr"/);
  });

  it('locale() y t() usan el idioma de la petición en curso', () => {
    const result = runWithLocale('en', () => [currentLocale(), i18n.locale(), i18n.t('books.notFound', { id: 1 })]);

    assert.deepEqual(result, ['en', 'en', 'Book 1 does not exist']);
    assert.equal(currentLocale(), undefined);
    assert.equal(i18n.locale(), 'es');
  });

  it('resolveMessage solo resuelve claves conocidas', () => {
    assert.equal(i18n.resolveMessage('books.notFound', { id: 2 }, {} as never), 'No existe el libro 2');
    assert.equal(i18n.resolveMessage('Libro no encontrado', undefined, {} as never), undefined);
  });
});

const CreateBook = z.object({ title: z.string().min(1) });

@Controller('/books')
class BooksController {
  @Get('/missing')
  missing() {
    throw new NotFoundException('books.notFound', { id: 3 });
  }

  @Post()
  @Validate({ body: CreateBook })
  create({ body }: HttpContext<{ body: typeof CreateBook }>) {
    return body;
  }
}

@Module({ controllers: [BooksController] })
class BooksModule {}

const zodLocales = { es: z.locales.es, en: z.locales.en };

describe('I18n integrado en la app', () => {
  let server: TestServer;

  before(async () => {
    @Module({
      imports: [
        ValidationModule.forRoot({
          formatIssue: (issue) => {
            const locale = i18n.locale() as keyof typeof zodLocales;
            const result = zodLocales[locale]().localeError(issue as never);
            return typeof result === 'string' ? result : result?.message;
          },
        }),
        BooksModule,
      ],
    })
    class AppModule {}

    server = await startTestServer(AppModule, {
      resolveMessage: i18n.resolveMessage,
      configure: (app) => app.useAuthGuard(() => true).use(i18n.middleware),
    });
  });

  after(() => server.close());

  it('responde en el idioma pedido con Accept-Language', async () => {
    const english = await server.request<ApiErrorBody>('/nope', {
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });
    const spanish = await server.request<ApiErrorBody>('/nope', {
      headers: { 'accept-language': 'es-CO' },
    });

    assert.equal(english.body.message, 'The requested route does not exist');
    assert.equal(english.headers.get('content-language'), 'en');
    assert.equal(spanish.body.message, 'La ruta solicitada no existe');
    assert.equal(spanish.headers.get('content-language'), 'es');
  });

  it('mantiene un código estable independiente del idioma', async () => {
    const english = await server.request<ApiErrorBody>('/books/missing', { headers: { 'accept-language': 'en' } });
    const spanish = await server.request<ApiErrorBody>('/books/missing', { headers: { 'accept-language': 'es' } });

    assert.equal(english.body.code, 'books.notFound');
    assert.equal(spanish.body.code, 'books.notFound');
    assert.equal(english.body.message, 'Book 3 does not exist');
    assert.equal(spanish.body.message, 'No existe el libro 3');
  });

  it('usa el idioma por defecto sin Accept-Language', async () => {
    const { body } = await server.request<ApiErrorBody>('/books/missing');

    assert.equal(body.message, 'No existe el libro 3');
  });

  it('traduce los mensajes de validación combinando viga/i18n y viga/validation', async () => {
    const request = (language: string) =>
      server.request<ApiErrorBody>('/books', {
        method: 'POST',
        json: { title: '' },
        headers: { 'accept-language': language },
      });
    const issueOf = (body: ApiErrorBody) => (body.details as ValidationErrors).body?.[0];

    const english = await request('en');
    const spanish = await request('es');

    assert.equal(english.body.message, 'Invalid input data');
    assert.equal(spanish.body.message, 'Datos de entrada inválidos');
    assert.equal(issueOf(english.body)?.code, 'too_small');
    assert.match(issueOf(english.body)?.message ?? '', /too small/i);
    assert.match(issueOf(spanish.body)?.message ?? '', /demasiado peque/i);
  });
});
