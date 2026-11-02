import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Module, type AnyConstructor } from '../../src/index.ts';
import { createTestingApp } from '../../src/testing/index.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = join(root, 'src/cli/index.ts');

describe('viga generate', () => {
  let project: string;

  before(() => {
    project = mkdtempSync(join(here, 'generated-'));
    writeFileSync(join(project, 'package.json'), JSON.stringify({ type: 'module', dependencies: { zod: '*' } }));
  });

  after(() => rmSync(project, { recursive: true, force: true }));

  function run(args: string[], cwd = project) {
    return spawnSync(process.execPath, ['--import', join(root, 'node_modules/tsx/dist/loader.mjs'), cli, ...args], {
      cwd,
      encoding: 'utf8',
    });
  }

  function useLocalViga(directory: string) {
    const toSrc = relative(join(project, directory), join(root, 'src'));
    for (const file of readdirSync(join(project, directory))) {
      const path = join(project, directory, file);
      const content = readFileSync(path, 'utf8')
        .replace("from '@vigajs/core/validation'", `from '${toSrc}/validation/index.ts'`)
        .replace("from '@vigajs/core'", `from '${toSrc}/index.ts'`);
      writeFileSync(path, content);
    }
  }

  async function crudAppFrom(directory: string, moduleFile: string, exportName: string) {
    useLocalViga(directory);
    const imported: Record<string, AnyConstructor> = await import(pathToFileURL(join(project, directory, moduleFile)).href);
    const GeneratedModule = imported[exportName];
    assert.ok(GeneratedModule);

    @Module({ imports: [GeneratedModule] })
    class AppModule {}

    return createTestingApp(AppModule, { configure: (app) => app.useAuthGuard(() => true) });
  }

  async function assertCrud(app: Awaited<ReturnType<typeof crudAppFrom>>, route: string) {
    const created = await app.request<{ id: number; name: string }>(route, { method: 'POST', json: { name: 'Dune' } });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body, { id: 1, name: 'Dune' });

    assert.equal((await app.request(route, { method: 'POST', json: { name: '' } })).status, 400);
    assert.equal((await app.request(route, { method: 'POST', json: { name: 'a', extra: true } })).status, 400);

    assert.deepEqual((await app.request(route)).body, [{ id: 1, name: 'Dune' }]);
    assert.deepEqual((await app.request(`${route}/1`)).body, { id: 1, name: 'Dune' });
    assert.equal((await app.request(`${route}/99`)).status, 404);
    assert.equal((await app.request(`${route}/abc`)).status, 400);

    const updated = await app.request(`${route}/1`, { method: 'PATCH', json: { name: 'Hyperion' } });
    assert.deepEqual(updated.body, { id: 1, name: 'Hyperion' });

    assert.equal((await app.request(`${route}/1`, { method: 'DELETE' })).status, 204);
    assert.equal((await app.request(`${route}/1`)).status, 404);
  }

  it('un resource con Zod crea sus archivos y funciona', async () => {
    const { status, stdout } = run(['g', 'resource', 'books']);

    assert.equal(status, 0);
    assert.deepEqual(readdirSync(join(project, 'src/books')).sort(), [
      'books.controller.ts',
      'books.module.ts',
      'books.schemas.ts',
      'books.service.ts',
    ]);
    assert.match(stdout, /created src\/books\/books\.module\.ts/);
    assert.match(stdout, /Add BooksModule to the imports of src\/app\.module\.ts/);
    assert.match(stdout, /private by default/);
    assert.match(readFileSync(join(project, 'src/books/books.schemas.ts'), 'utf8'), /CreateBook = z\.strictObject/);

    const app = await crudAppFrom('src/books', 'books.module.ts', 'BooksModule');
    await assertCrud(app, '/books');
    await app.close();
  });

  it('un resource con Valibot funciona igual', async () => {
    assert.equal(run(['generate', 'resource', 'authors', '--schema', 'valibot']).status, 0);
    assert.match(readFileSync(join(project, 'src/authors/authors.schemas.ts'), 'utf8'), /v\.strictObject/);

    const app = await crudAppFrom('src/authors', 'authors.module.ts', 'AuthorsModule');
    await assertCrud(app, '/authors');
    await app.close();
  });

  it('nombres compuestos y plurales irregulares', async () => {
    assert.equal(run(['g', 'resource', 'order-items']).status, 0);
    assert.equal(run(['g', 'resource', 'categories']).status, 0);
    assert.equal(run(['g', 'resource', 'address']).status, 0);

    assert.match(readFileSync(join(project, 'src/order-items/order-items.schemas.ts'), 'utf8'), /CreateOrderItem/);
    assert.match(readFileSync(join(project, 'src/categories/categories.schemas.ts'), 'utf8'), /CreateCategory/);
    assert.match(readFileSync(join(project, 'src/address/address.schemas.ts'), 'utf8'), /CreateAddress/);

    const app = await crudAppFrom('src/order-items', 'order-items.module.ts', 'OrderItemsModule');
    await assertCrud(app, '/order-items');
    await app.close();
  });

  it('las rutas son privadas: sin autenticación responden 401', async () => {
    assert.equal(run(['g', 'resource', 'secrets']).status, 0);
    useLocalViga('src/secrets');
    const { SecretsModule } = await import(pathToFileURL(join(project, 'src/secrets/secrets.module.ts')).href);

    @Module({ imports: [SecretsModule] })
    class AppModule {}

    const app = await createTestingApp(AppModule);
    assert.equal((await app.request('/secrets')).status, 401);
    await app.close();
  });

  it('crea piezas sueltas, que también cargan', async () => {
    assert.equal(run(['g', 'module', 'shop']).status, 0);
    assert.equal(run(['g', 'controller', 'shop']).status, 0);
    const service = run(['g', 'service', 'shop']);
    assert.equal(service.status, 0);
    assert.match(service.stdout, /Add ShopService to the providers of src\/shop\/shop\.module\.ts/);
    assert.deepEqual(readdirSync(join(project, 'src/shop')).sort(), ['shop.controller.ts', 'shop.module.ts', 'shop.service.ts']);

    const app = await crudAppFrom('src/shop', 'shop.module.ts', 'ShopModule');
    await app.close();
  });

  it('un module o controller no necesita librería de validación', () => {
    const empty = mkdtempSync(join(here, 'generated-'));
    try {
      writeFileSync(join(empty, 'package.json'), JSON.stringify({ dependencies: {} }));
      assert.equal(run(['g', 'module', 'a'], empty).status, 0);
      assert.equal(run(['g', 'controller', 'a'], empty).status, 0);

      const { status, stderr } = run(['g', 'resource', 'b'], empty);
      assert.equal(status, 1);
      assert.match(stderr, /install zod or valibot/);
      assert.equal(existsSync(join(empty, 'src/b')), false);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('no toca archivos existentes, y no crea nada si alguno existe', () => {
    mkdirSync(join(project, 'src/kept'), { recursive: true });
    writeFileSync(join(project, 'src/kept/kept.service.ts'), 'mine');

    const { status, stderr } = run(['g', 'resource', 'kept']);

    assert.equal(status, 1);
    assert.match(stderr, /already exist/);
    assert.equal(readFileSync(join(project, 'src/kept/kept.service.ts'), 'utf8'), 'mine');
    assert.deepEqual(readdirSync(join(project, 'src/kept')), ['kept.service.ts']);
  });

  it('el nombre puede incluir carpetas, que no cambian la ruta de la API', async () => {
    const { status, stdout } = run(['g', 'resource', 'service/reviews']);

    assert.equal(status, 0);
    assert.match(stdout, /created src\/service\/reviews\/reviews\.module\.ts/);
    assert.deepEqual(readdirSync(join(project, 'src/service/reviews')).sort(), [
      'reviews.controller.ts',
      'reviews.module.ts',
      'reviews.schemas.ts',
      'reviews.service.ts',
    ]);

    const app = await crudAppFrom('src/service/reviews', 'reviews.module.ts', 'ReviewsModule');
    await assertCrud(app, '/reviews');
    await app.close();
  });

  it('las carpetas del nombre se suman a --path', () => {
    const { status, stdout } = run(['g', 'service', 'a/b/c', '--path', 'lib']);

    assert.equal(status, 0);
    assert.ok(existsSync(join(project, 'lib/a/b/c/c.service.ts')));
    assert.match(stdout, /Add CService to the providers of lib\/a\/b\/c\/c\.module\.ts/);
  });

  it('acepta otra carpeta dentro del proyecto', () => {
    assert.equal(run(['g', 'service', 'audit', '--path', 'src/admin']).status, 0);
    assert.ok(existsSync(join(project, 'src/admin/audit/audit.service.ts')));
  });

  it('rechaza entradas inválidas sin crear nada', () => {
    for (const args of [
      ['build'],
      ['g'],
      ['g', 'resource'],
      ['g', 'thing', 'a'],
      ['g', 'module', 'a', 'b'],
      ['g', 'module', 'Books'],
      ['g', 'module', '../evil'],
      ['g', 'module', '../evil/ok'],
      ['g', 'module', 'a/../../evil'],
      ['g', 'module', '/tmp/evil'],
      ['g', 'module', 'a//b'],
      ['g', 'module', 'a/'],
      ['g', 'module', 'A/b'],
      ['g', 'module', 'a\\b'],
      ['g', 'module', '1books'],
      ['g', 'module', 'a--b'],
      ['g', 'module', 'ok', '--path', '../outside'],
      ['g', 'module', 'ok', '--path', '/tmp/outside'],
      ['g', 'resource', 'ok', '--schema', 'joi'],
      ['g', 'module', 'ok', '--unknown'],
    ]) {
      assert.equal(run(args).status, 1, args.join(' '));
    }
    assert.equal(existsSync(join(project, 'src/ok')), false);
    assert.equal(existsSync(join(project, '../outside')), false);
  });

  it('muestra la ayuda', () => {
    for (const args of [[], ['--help']]) {
      const { status, stdout } = run(args);
      assert.equal(status, 0);
      assert.match(stdout, /viga generate <kind> <name>/);
    }
  });

  it('un resource fuera de un proyecto da un error claro', () => {
    const outside = mkdtempSync(join(here, 'generated-'));
    try {
      const { status, stderr } = run(['g', 'resource', 'books'], outside);
      assert.equal(status, 1);
      assert.match(stderr, /root of your project/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
