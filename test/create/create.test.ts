import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../packages/create/index.js', import.meta.url));

describe('@vigajs/create', () => {
  let directory: string;

  before(() => {
    directory = mkdtempSync(join(tmpdir(), 'vigajs-create-test-'));
  });

  after(() => rmSync(directory, { recursive: true, force: true }));

  function run(args: string[], userAgent = 'pnpm/12.11.2 node/v24.13.0') {
    return spawnSync(process.execPath, [script, ...args], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, npm_config_user_agent: userAgent },
    });
  }

  const read = (name: string, path: string) => readFileSync(join(directory, name, path), 'utf8');

  it('crea un proyecto completo con los scripts y la configuración base', () => {
    const { status, stdout } = run(['my-app']);

    assert.equal(status, 0);
    const pkg = JSON.parse(read('my-app', 'package.json'));
    assert.equal(pkg.name, 'my-app');
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.private, true);
    assert.deepEqual(Object.keys(pkg.scripts), ['dev', 'build', 'start']);
    assert.deepEqual(Object.keys(pkg.dependencies), ['@vigajs/core', 'express', 'zod']);
    assert.deepEqual(JSON.parse(read('my-app', 'tsconfig.json')), { extends: '@vigajs/core/tsconfig.json', include: ['src'] });
    for (const file of ['.gitignore', 'src/main.ts', 'src/app.module.ts', 'src/hello/hello.controller.ts']) {
      assert.ok(existsSync(join(directory, 'my-app', file)), file);
    }
    assert.match(stdout, /pnpm install/);
    assert.match(stdout, /pnpm dev/);
  });

  it('elige la librería de validación', () => {
    assert.equal(run(['with-valibot', '--schema', 'valibot']).status, 0);
    assert.deepEqual(Object.keys(JSON.parse(read('with-valibot', 'package.json')).dependencies), ['@vigajs/core', 'express', 'valibot']);

    assert.equal(run(['without-schema', '--schema', 'none']).status, 0);
    assert.deepEqual(Object.keys(JSON.parse(read('without-schema', 'package.json')).dependencies), ['@vigajs/core', 'express']);
  });

  it('adapta los siguientes pasos a cada gestor de paquetes', () => {
    assert.match(run(['with-npm'], 'npm/11.6.2 node/v24.13.0').stdout, /npm run dev/);
    assert.match(run(['with-bun'], 'bun/1.3.0').stdout, /bun dev/);
    assert.match(run(['unknown-agent'], '').stdout, /npm run dev/);
  });

  it('con pnpm permite el script de instalación de esbuild', () => {
    run(['with-pnpm']);
    assert.equal(read('with-pnpm', 'pnpm-workspace.yaml'), 'allowBuilds:\n  esbuild: true\n');

    run(['with-npm-only'], 'npm/11.6.2 node/v24.13.0');
    assert.equal(existsSync(join(directory, 'with-npm-only', 'pnpm-workspace.yaml')), false);
  });

  it('con Yarn 2 o superior usa node_modules', () => {
    run(['with-yarn-4'], 'yarn/4.5.0 npm/? node/v24.13.0');
    assert.equal(read('with-yarn-4', '.yarnrc.yml'), 'nodeLinker: node-modules\n');

    run(['with-yarn-1'], 'yarn/1.22.0 npm/? node/v24.13.0');
    assert.equal(existsSync(join(directory, 'with-yarn-1', '.yarnrc.yml')), false);
  });

  it('acepta una carpeta vacía y rutas anidadas', () => {
    mkdirSync(join(directory, 'empty'));
    assert.equal(run(['empty']).status, 0);

    assert.equal(run(['nested/deep/app']).status, 0);
    assert.equal(JSON.parse(read('nested/deep/app', 'package.json')).name, 'app');
  });

  it('no toca una carpeta con contenido', () => {
    mkdirSync(join(directory, 'taken'));
    writeFileSync(join(directory, 'taken', 'keep.txt'), 'keep');

    const { status, stderr } = run(['taken']);

    assert.equal(status, 1);
    assert.match(stderr, /not empty/);
    assert.deepEqual(readdirSync(join(directory, 'taken')), ['keep.txt']);
  });

  it('rechaza entradas inválidas sin crear nada', () => {
    const before = readdirSync(directory).length;

    for (const args of [[], ['a', 'b'], ['Bad Name'], ['UPPER'], ['-x'], ['ok-name', '--schema', 'joi'], ['ok-name', '--unknown']]) {
      assert.equal(run(args).status, 1, args.join(' '));
    }
    assert.equal(readdirSync(directory).length, before);
  });
});
