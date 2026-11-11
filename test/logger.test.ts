import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createConsoleLogger } from '../src/logger.ts';

type Level = 'info' | 'warn' | 'error' | 'debug';

function recorder() {
  const calls: { level: Level; args: unknown[] }[] = [];
  const record = (level: Level) => (...args: unknown[]) => calls.push({ level, args });
  return { calls, console: { info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug') } };
}

function terminal() {
  return Object.assign(new PassThrough(), { isTTY: true, getColorDepth: () => 8, hasColors: () => true });
}

describe('createConsoleLogger', () => {
  const saved = { FORCE_COLOR: process.env.FORCE_COLOR, NO_COLOR: process.env.NO_COLOR };

  beforeEach(() => {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('colorea el área según el nivel cuando escribe en una terminal', () => {
    const { calls, console } = recorder();
    const logger = createConsoleLogger({ console, stdout: terminal(), stderr: terminal() });

    logger.info('[App] Server listening on port 3000');
    logger.warn('[App] No auth guard');
    logger.error('[HTTP] Unhandled exception');

    assert.deepEqual(
      calls.map((call) => call.args[0]),
      [
        '\u001b[36m[App]\u001b[39m Server listening on port 3000',
        '\u001b[33m[App]\u001b[39m No auth guard',
        '\u001b[31m[HTTP]\u001b[39m Unhandled exception',
      ]
    );
    assert.deepEqual(
      calls.map((call) => call.level),
      ['info', 'warn', 'error']
    );
  });

  it('pone todo el mensaje de debug en gris', () => {
    const { calls, console } = recorder();
    createConsoleLogger({ console, stdout: terminal() }).debug('[App] Public routes: GET /books');

    assert.equal(calls[0]?.args[0], '\u001b[90m[App] Public routes: GET /books\u001b[39m');
  });

  it('deja igual los mensajes sin área y pasa los metadatos sin tocarlos', () => {
    const { calls, console } = recorder();
    const error = new Error('boom');
    createConsoleLogger({ console, stderr: terminal() }).error('algo falló', error, { requestId: 'r1' });

    assert.deepEqual(calls[0]?.args, ['algo falló', error, { requestId: 'r1' }]);
  });

  it('no colorea cuando la salida no es una terminal', () => {
    const { calls, console } = recorder();
    createConsoleLogger({ console, stdout: new PassThrough() }).info('[App] Server listening on port 3000');

    assert.equal(calls[0]?.args[0], '[App] Server listening on port 3000');
  });

  it('usa el console global en el momento de escribir', () => {
    const logger = createConsoleLogger({ stdout: new PassThrough() });
    const original = globalThis.console.info;
    const printed: unknown[] = [];
    globalThis.console.info = (...args: unknown[]) => printed.push(args);
    try {
      logger.info('[App] hola');
    } finally {
      globalThis.console.info = original;
    }

    assert.deepEqual(printed, [['[App] hola']]);
  });
});
