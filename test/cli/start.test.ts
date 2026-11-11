import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = join(root, 'src/cli/index.ts');

describe('viga start', () => {
  let project: string;

  before(() => {
    project = mkdtempSync(join(here, 'start-'));
    writeFileSync(join(project, 'package.json'), JSON.stringify({ type: 'module' }));
    mkdirSync(join(project, 'dist'));
  });

  after(() => rmSync(project, { recursive: true, force: true }));

  function run(args: string[]) {
    return spawnSync(process.execPath, ['--import', join(root, 'node_modules/tsx/dist/loader.mjs'), cli, 'start', ...args], {
      cwd: project,
      encoding: 'utf8',
    });
  }

  function entry(code: string, file = 'dist/main.js') {
    writeFileSync(join(project, file), code);
  }

  it('ejecuta dist/main.js y carga el .env', () => {
    writeFileSync(join(project, '.env'), 'GREETING=hola\n');
    entry('console.log("started", process.env.GREETING);');

    const { status, stdout } = run([]);

    assert.equal(status, 0);
    assert.match(stdout, /started hola/);
  });

  it('arranca sin .env', () => {
    rmSync(join(project, '.env'), { force: true });
    entry('console.log("started", process.env.GREETING ?? "sin variable");');

    const { status, stdout } = run([]);

    assert.equal(status, 0);
    assert.match(stdout, /started sin variable/);
  });

  it('devuelve el código de salida de la app', () => {
    entry('process.exit(3);');
    assert.equal(run([]).status, 3);
  });

  it('pasa a Node.js las opciones que van después de --', () => {
    entry('console.log(process.execArgv.join(" "));');

    const { stdout } = run(['--', '--enable-source-maps']);

    assert.match(stdout, /--enable-source-maps/);
  });

  it('acepta otra entrada y otro archivo de variables', () => {
    writeFileSync(join(project, '.env.local'), 'GREETING=local\n');
    entry('console.log("server", process.env.GREETING);', 'dist/server.js');

    const { status, stdout } = run(['--entry', 'dist/server.js', '--env-file', '.env.local']);

    assert.equal(status, 0);
    assert.match(stdout, /server local/);
  });

  it('explica qué hacer si la entrada no existe', () => {
    const { status, stderr } = run(['--entry', 'dist/missing.js']);

    assert.equal(status, 1);
    assert.match(stderr, /dist\/missing\.js does not exist; build the app first/);
  });
});
