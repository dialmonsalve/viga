import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = join(root, 'src/cli/index.ts');
const loader = join(root, 'node_modules/tsx/dist/loader.mjs');

const TSCONFIG = {
  compilerOptions: { strict: true, noEmit: true, module: 'nodenext', target: 'es2024', types: ['node'] },
  include: ['src'],
};

const KEEP_ALIVE = 'setInterval(() => {}, 1000);\n';

function plainEnv() {
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  return env;
}

describe('viga dev', () => {
  let project: string;
  let running: { child: ChildProcess; output: () => string; waitFor: (pattern: RegExp) => Promise<void> } | undefined;

  beforeEach(() => {
    project = mkdtempSync(join(here, 'dev-'));
    mkdirSync(join(project, 'src'));
    writeFileSync(join(project, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(project, 'tsconfig.json'), JSON.stringify(TSCONFIG));
  });

  afterEach(async () => {
    if (running && running.child.exitCode === null && running.child.signalCode === null) {
      const exited = new Promise((resolve) => running?.child.once('close', resolve));
      running.child.kill('SIGTERM');
      await exited;
    }
    running = undefined;
    rmSync(project, { recursive: true, force: true });
  });

  function write(file: string, content: string) {
    writeFileSync(join(project, file), content);
  }

  function start(args: string[] = []) {
    const child = spawn(process.execPath, ['--import', loader, cli, 'dev', ...args], {
      cwd: project,
      env: plainEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const listeners = new Set<() => void>();
    const append = (chunk: Buffer) => {
      output += chunk.toString();
      for (const listener of listeners) listener();
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const waitFor = (pattern: RegExp, timeoutMs = 20_000) =>
      new Promise<void>((resolve, reject) => {
        const check = () => {
          if (!pattern.test(output)) return;
          clearTimeout(timer);
          listeners.delete(check);
          resolve();
        };
        const timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error(`${pattern} did not appear in:\n${output}`));
        }, timeoutMs);
        listeners.add(check);
        check();
      });

    running = { child, output: () => output, waitFor };
    return running;
  }

  it('arranca la app con tsx, carga el .env y etiqueta cada salida', async () => {
    write('.env', 'GREETING=hola\n');
    write('src/main.ts', `console.log('ready', process.env.GREETING);\n${KEEP_ALIVE}`);

    const dev = start();

    await dev.waitFor(/\[app\]\s+ready hola/);
    await dev.waitFor(/\[types\]\s+No type errors/);
  });

  it('muestra los errores de tipos y vuelve a revisarlos al guardar', async () => {
    write('src/main.ts', `const count: number = 'one';\nconsole.log('ready', count);\n${KEEP_ALIVE}`);

    const dev = start();

    await dev.waitFor(/\[types\].*TS2322/);
    write('src/main.ts', `const count: number = 1;\nconsole.log('ready', count);\n${KEEP_ALIVE}`);
    await dev.waitFor(/\[types\]\s+No type errors/);
  });

  it('se reinicia al corregir un archivo importado después de un error de arranque', async () => {
    write('src/main.ts', `import './dep.ts';\nconsole.log('ready');\n${KEEP_ALIVE}`);
    write('src/dep.ts', `throw new Error('boom');\n`);

    const dev = start(['--no-check']);

    await dev.waitFor(/\[app\]\s+Error: boom/);
    write('src/dep.ts', `export const ok = true;\n`);
    await dev.waitFor(/\[app\]\s+ready/);
  });

  it('con --no-check no revisa los tipos', async () => {
    write('src/main.ts', `const count: number = 'one';\nconsole.log('ready', count);\n${KEEP_ALIVE}`);

    const dev = start(['--no-check']);

    await dev.waitFor(/\[app\]\s+ready one/);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.doesNotMatch(dev.output(), /\[types\]/);
    assert.doesNotMatch(dev.output(), /\.env not found/);
  });

  it('acepta otra entrada y pasa a Node.js las opciones que van después de --', async () => {
    write('src/server.ts', `console.log('flags', process.execArgv.includes('--enable-source-maps'));\n${KEEP_ALIVE}`);

    const dev = start(['--entry', 'src/server.ts', '--no-check', '--', '--enable-source-maps']);

    await dev.waitFor(/\[app\]\s+flags true/);
  });

  it('se detiene con SIGTERM, termina con código 0 y no deja procesos', async () => {
    write('src/main.ts', `console.log('ready');\n${KEEP_ALIVE}`);
    const dev = start();
    await dev.waitFor(/\[app\]\s+ready/);

    const closed = new Promise<number | null>((resolve) => dev.child.once('close', (code) => resolve(code)));
    dev.child.kill('SIGTERM');

    assert.equal(await closed, 0);
    const leftovers = spawnSync('pgrep', ['-f', project], { encoding: 'utf8' }).stdout.trim();
    assert.equal(leftovers, '');
  });

  it('explica qué hacer si la entrada no existe', () => {
    const { status, stderr } = spawnSync(process.execPath, ['--import', loader, cli, 'dev'], {
      cwd: project,
      encoding: 'utf8',
    });

    assert.equal(status, 1);
    assert.match(stderr, /src\/main\.ts does not exist; pass your entry file with --entry/);
  });
});
