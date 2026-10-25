import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { DIAGNOSTICS, Injector, setDiagnostics, type DiagnosticKey } from '../src/index.ts';
import { diagnostic } from '../src/diagnostics.ts';
import { diagnosticsEs } from '../src/i18n/index.ts';

const KEYS = Object.keys(DIAGNOSTICS) as DiagnosticKey[];

const placeholders = (template: string) => [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('mensajes para desarrolladores', () => {
  afterEach(() => setDiagnostics({}));

  it('están en inglés por defecto, con el prefijo de su área y los parámetros', () => {
    assert.equal(
      diagnostic('di.circularDependency', { injector: 'BooksModule', chain: 'A -> B -> A' }),
      '[DI] Circular dependency in BooksModule: A -> B -> A'
    );
    assert.throws(() => new Injector().get(Injector), /^Error: \[DI\] Injector cannot resolve Injector/);
  });

  it('setDiagnostics() reemplaza los mensajes por los del diccionario', () => {
    setDiagnostics(diagnosticsEs);

    assert.throws(
      () => new Injector().get(Injector),
      /^Error: \[DI\] Injector no puede resolver Injector: falta en providers/
    );
  });

  it('un diccionario parcial usa el inglés para las claves que no traduce', () => {
    setDiagnostics({ 'app.alreadyListening': 'Ya está escuchando' });

    assert.equal(diagnostic('app.alreadyListening'), '[App] Ya está escuchando');
    assert.equal(diagnostic('app.closeFailed'), '[App] Error while shutting down');
  });

  it('setDiagnostics({}) vuelve al inglés', () => {
    setDiagnostics(diagnosticsEs);
    setDiagnostics({});

    assert.equal(diagnostic('app.closeFailed'), '[App] Error while shutting down');
  });

  it('cada clave tiene un prefijo de área conocido', () => {
    for (const key of KEYS) {
      assert.match(diagnostic(key), /^\[(DI|Module|Router|Interceptor|RateLimit|Lifecycle|App|HTTP|Context|I18n|Drizzle|Pagination|WebSocket)\] /, key);
    }
  });

  it('el diccionario en español conserva los parámetros de cada mensaje', () => {
    for (const key of KEYS) {
      assert.deepEqual(placeholders(diagnosticsEs[key]), placeholders(DIAGNOSTICS[key]), key);
    }
  });
});
