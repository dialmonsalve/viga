import assert from 'node:assert/strict';
import { spawn, fork } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable, Module, createApp, inject, silentLogger, type App, type Logger } from '../../src/index.ts';
import {
  WORKER_KEY,
  WorkerModule,
  WorkerSupervisor,
  WorkersModule,
  startWorker,
  type WorkersOptions,
} from '../../src/workers/index.ts';
import { restartDelay } from '../../src/workers/supervisor.ts';

const entry = new URL('./fixtures/worker.ts', import.meta.url);
const execArgv = ['--import', 'tsx', '--import', './test/setup.ts'];

let directory: string;
let logPath: string;
let counter = 0;
let running: App | undefined;

function readLog() {
  return existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n') : [];
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out; log: ${readLog().join(' | ')}`);
    await sleep(20);
  }
}

function capturingLogger() {
  const lines: string[] = [];
  const push = (message: unknown) => {
    lines.push(String(message));
  };
  const logger: Logger = { info: push, warn: push, error: push, debug: () => {} };
  return { lines, logger };
}

async function start(options: Partial<WorkersOptions> = {}, logger: Logger = silentLogger) {
  @Module({
    imports: [
      WorkersModule.forRoot({
        entry,
        execArgv,
        env: { ...process.env, NODE_TEST_CONTEXT: undefined, VIGA_TEST_LOG: logPath },
        ...options,
      }),
    ],
  })
  class AppModule {}

  const app = createApp({ rootModule: AppModule, logger });
  running = app;
  await app.init();
  return { app, supervisor: app.get(WorkerSupervisor) };
}

describe('viga/workers', () => {
  before(() => {
    directory = mkdtempSync(join(tmpdir(), 'viga-workers-'));
  });

  after(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  afterEach(async () => {
    await running?.close();
    running = undefined;
    logPath = join(directory, `log-${++counter}`);
  });

  logPath = join(tmpdir(), `viga-workers-${process.pid}-0`);

  describe('WorkerModule.forKey', () => {
    it('entrega la clave dentro de la API, sin procesos hijos', async () => {
      @Injectable()
      class Worker {
        readonly key = inject(WORKER_KEY);
      }

      @Module({ imports: [WorkerModule.forKey('emails')], providers: [Worker] })
      class AppModule {}

      const app = createApp({ rootModule: AppModule, logger: silentLogger });
      await app.init();
      assert.equal(app.get(Worker).key, 'emails');
      await app.close();
    });

    it('rechaza claves inválidas', () => {
      for (const key of ['', '-rm', '--inspect', 'a b', 'a/b', '../x', 'a\nb', 'x'.repeat(129)]) {
        assert.throws(() => WorkerModule.forKey(key), /worker key/, key);
      }
      for (const key of ['emails', 'tenant-1', 'imports:acme', 'a.b_c', 'x'.repeat(128)]) {
        assert.doesNotThrow(() => WorkerModule.forKey(key));
      }
    });
  });

  describe('startWorker', () => {
    it('arranca sin servidor y entrega la clave, y el módulo sigue siendo la raíz', async () => {
      @Injectable()
      class Worker {
        readonly key = inject(WORKER_KEY);
      }

      @Module({ providers: [Worker] })
      class AppModule {}

      const app = await startWorker(AppModule, { key: 'emails', logger: silentLogger });
      assert.equal(app.get(Worker).key, 'emails');
      await app.close();
    });

    it('sin clave o con una inválida da un error claro', async () => {
      @Module({})
      class AppModule {}

      const argv = process.argv;
      process.argv = ['node', 'worker.js'];
      try {
        await assert.rejects(startWorker(AppModule, { logger: silentLogger }), /first argument/);
      } finally {
        process.argv = argv;
      }
      await assert.rejects(startWorker(AppModule, { key: '--evil', logger: silentLogger }), /worker key/);
    });

    it('se puede ejecutar sin supervisor, como en Docker', async () => {
      const child = spawn(process.execPath, [...execArgv, entry.pathname, 'standalone'], {
        env: { ...process.env, NODE_TEST_CONTEXT: undefined, VIGA_TEST_LOG: logPath },
        stdio: 'ignore',
      });

      await waitFor(() => readLog().some((line) => line.startsWith('up standalone')));
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');

      assert.equal(await exited, 143);
      assert.ok(readLog().includes('destroyed standalone'));
    });

    it('si falla al arrancar, el proceso termina con error', async () => {
      const child = spawn(process.execPath, [...execArgv, entry.pathname, 'failinit'], {
        env: { ...process.env, NODE_TEST_CONTEXT: undefined, VIGA_TEST_LOG: logPath },
        stdio: 'ignore',
      });

      assert.equal(await new Promise((resolve) => child.once('exit', resolve)), 1);
    });
  });

  describe('WorkerSupervisor', () => {
    it('arranca las claves iniciales, sin duplicados, y las lista', async () => {
      const { supervisor } = await start({ keys: ['a', 'b', 'a'] });

      await waitFor(() => readLog().length === 2);
      const list = supervisor.list();

      assert.deepEqual(list.map(({ key, status, restarts }) => ({ key, status, restarts })), [
        { key: 'a', status: 'running', restarts: 0 },
        { key: 'b', status: 'running', restarts: 0 },
      ]);
      assert.ok(list.every(({ pid }) => typeof pid === 'number' && pid !== process.pid));
    });

    it('acepta claves desde una función async', async () => {
      const { supervisor } = await start({ keys: async () => ['from-db'] });
      assert.deepEqual(supervisor.list().map(({ key }) => key), ['from-db']);
    });

    it('start y stop gestionan workers con la app en marcha', async () => {
      const { supervisor } = await start();

      await supervisor.start('tenant-1');
      await supervisor.start('tenant-1');
      await waitFor(() => readLog().length === 1);
      assert.equal(supervisor.list().length, 1);

      await supervisor.stop('tenant-1');
      assert.ok(readLog().includes('destroyed tenant-1'));
      assert.deepEqual(supervisor.list(), []);

      await supervisor.stop('unknown');
    });

    it('al detener la app, cada worker termina ordenadamente', async () => {
      const { app } = await start({ keys: ['a', 'b'] });
      await waitFor(() => readLog().length === 2);

      await app.close();

      assert.ok(readLog().includes('destroyed a'));
      assert.ok(readLog().includes('destroyed b'));
    });

    it('reinicia un worker caído y cuenta los reinicios', async () => {
      const { lines, logger } = capturingLogger();
      const { supervisor } = await start({ keys: ['crash'] }, logger);

      await waitFor(() => readLog().filter((line) => line.startsWith('up crash')).length >= 2);

      assert.ok(supervisor.list()[0]!.restarts >= 1);
      assert.ok(lines.some((line) => /crash exited with code 7; restarting it in 1000 ms/.test(line)));
    });

    it('la espera entre reinicios crece hasta un máximo', () => {
      assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(restartDelay), [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    });

    it('stop cancela un reinicio pendiente', async () => {
      const { supervisor } = await start({ keys: ['crash'] });

      await waitFor(() => supervisor.list()[0]?.status === 'restarting');
      await supervisor.stop('crash');
      const before = readLog().length;
      await sleep(1_200);

      assert.deepEqual(supervisor.list(), []);
      assert.equal(readLog().length, before);
    });

    it('un worker que termina con código 0 no se reinicia', async () => {
      const { lines, logger } = capturingLogger();
      const { supervisor } = await start({ keys: ['done'] }, logger);

      await waitFor(() => supervisor.list().length === 0);
      await sleep(1_200);

      assert.equal(readLog().filter((line) => line.startsWith('up done')).length, 1);
      assert.ok(lines.some((line) => /done finished with code 0/.test(line)));
    });

    it('fuerza el cierre de un worker que no termina a tiempo', async () => {
      const { lines, logger } = capturingLogger();
      const { supervisor } = await start({ keys: ['stuck'], stopTimeoutMs: 100 }, logger);
      await waitFor(() => readLog().length === 1);

      await supervisor.stop('stuck');

      assert.deepEqual(supervisor.list(), []);
      assert.ok(lines.some((line) => /stuck did not stop within 100 ms/.test(line)));
    });

    it('respeta maxWorkers', async () => {
      const { supervisor } = await start({ keys: ['a'], maxWorkers: 1 });

      await assert.rejects(supervisor.start('b'), /maxWorkers \(1\)/);
      await supervisor.stop('a');
      await supervisor.start('b');
      assert.deepEqual(supervisor.list().map(({ key }) => key), ['b']);
    });

    it('al arrancar, no inicia ninguno si las claves superan el límite o son inválidas', async () => {
      await assert.rejects(start({ keys: ['a', 'b'], maxWorkers: 1 }), /maxWorkers \(1\)/);
      await assert.rejects(start({ keys: ['ok', '--evil'] }), /worker key/);
      await sleep(200);
      assert.deepEqual(readLog(), []);
    });

    it('rechaza start con una clave inválida o durante el cierre', async () => {
      const { app, supervisor } = await start();

      await assert.rejects(supervisor.start('--inspect'), /worker key/);
      await app.close();
      await assert.rejects(supervisor.start('late'), /shutting down/);
    });

    it('valida las opciones al arrancar', async () => {
      await assert.rejects(start({ maxWorkers: 0 }), /maxWorkers/);
      await assert.rejects(start({ stopTimeoutMs: 1.5 }), /stopTimeoutMs/);
      await assert.rejects(start({ entry: '/does/not/exist.ts' }), /does not exist/);
    });

    it('acepta la extensión .js o .ts indistintamente', async () => {
      const { supervisor } = await start({ entry: new URL('./fixtures/worker.js', import.meta.url), keys: ['swapped'] });

      await waitFor(() => readLog().length === 1);
      assert.equal(supervisor.list()[0]?.key, 'swapped');
    });
  });

  it('si el padre muere de golpe, el worker termina ordenadamente', async () => {
    const parent = fork(new URL('./fixtures/parent.ts', import.meta.url).pathname, [], {
      execArgv,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, VIGA_TEST_LOG: logPath },
    });
    await new Promise((resolve) => parent.once('message', resolve));
    await waitFor(() => readLog().some((line) => line.startsWith('up orphan')));

    parent.kill('SIGKILL');

    await waitFor(() => readLog().includes('destroyed orphan'));
  });

  it('si el padre muere y el cierre se cuelga, el worker termina igual', async () => {
    const parent = fork(new URL('./fixtures/parent.ts', import.meta.url).pathname, [], {
      execArgv,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, VIGA_TEST_LOG: logPath, VIGA_TEST_KEY: 'stuck' },
    });
    await new Promise((resolve) => parent.once('message', resolve));
    await waitFor(() => readLog().some((line) => line.startsWith('up stuck')));
    const pid = Number(readLog().find((line) => line.startsWith('up stuck'))?.split(' ')[2]);

    parent.kill('SIGKILL');

    const isRunning = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    await waitFor(() => !isRunning());
  });

  it('si el padre muere mientras el worker arranca, el worker también termina', async () => {
    const parent = fork(new URL('./fixtures/parent.ts', import.meta.url).pathname, [], {
      execArgv,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, VIGA_TEST_LOG: logPath, VIGA_TEST_KEY: 'orphan-slow' },
    });
    await new Promise((resolve) => parent.once('message', resolve));

    parent.kill('SIGKILL');

    await waitFor(() => readLog().includes('destroyed orphan-slow'));
  });
});
