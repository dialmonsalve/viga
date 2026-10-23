import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Injectable } from '../../src/decorators/injectable.ts';
import {
  InjectionToken,
  Injector,
  inject,
  injectorOf,
} from '../../src/di/injector.ts';

const CONFIG = new InjectionToken<{ name: string }>('CONFIG');

@Injectable()
class Logger {
  readonly lines: string[] = [];
}

@Injectable()
class Greeter {
  readonly logger = inject(Logger);
  readonly config = inject(CONFIG);
}

const configProvider = { provide: CONFIG, useValue: { name: 'app' } };

describe('Injector', () => {
  it('resuelve las dependencias declaradas con inject()', () => {
    const injector = new Injector([Logger, Greeter, configProvider]);
    const greeter = injector.get(Greeter);

    assert.ok(greeter.logger instanceof Logger);
    assert.deepEqual(greeter.config, { name: 'app' });
  });

  it('devuelve siempre la misma instancia dentro de un injector', () => {
    const injector = new Injector([Logger]);

    assert.equal(injector.get(Logger), injector.get(Logger));
  });

  it('crea instancias distintas en injectors distintos', () => {
    assert.notEqual(new Injector([Logger]).get(Logger), new Injector([Logger]).get(Logger));
  });

  it('registra una clase bajo otro token con useClass', () => {
    @Injectable()
    class ConsoleLogger extends Logger {}

    const injector = new Injector([{ provide: Logger, useClass: ConsoleLogger }]);

    assert.ok(injector.get(Logger) instanceof ConsoleLogger);
  });

  it('permite usar inject() dentro de useFactory', () => {
    const GREETING = new InjectionToken<string>('GREETING');
    const injector = new Injector([
      configProvider,
      { provide: GREETING, useFactory: () => `hola ${inject(CONFIG).name}` },
    ]);

    assert.equal(injector.get(GREETING), 'hola app');
  });

  it('permite sustituir dependencias por dobles de prueba con useValue', () => {
    const fakeLogger = { lines: ['mock'] };
    const injector = new Injector([Greeter, configProvider, { provide: Logger, useValue: fakeLogger }]);

    assert.equal(injector.get(Greeter).logger, fakeLogger);
  });

  it('falla con un mensaje claro si el token no está registrado', () => {
    assert.throws(() => new Injector().get(Logger), /\[DI\] Injector cannot resolve Logger/);
    assert.throws(() => new Injector().get(CONFIG), /cannot resolve InjectionToken\(CONFIG\)/);
  });

  it('exige @Injectable() en los providers de clase', () => {
    class Plain {}

    assert.throws(() => new Injector([Plain]), /Plain must be decorated with @Injectable/);
    assert.throws(
      () => new Injector([{ provide: Logger, useClass: Plain }]),
      /Plain must be decorated with @Injectable/
    );
  });

  it('detecta dependencias circulares', () => {
    @Injectable()
    class A {
      readonly b: unknown = inject(B);
    }

    @Injectable()
    class B {
      readonly a: unknown = inject(A);
    }

    assert.throws(() => new Injector([A, B]).get(A), /Circular dependency.*A -> B -> A/);
  });

  it('no permite usar inject() fuera del contenedor', () => {
    assert.throws(() => new Greeter(), /inject\(Logger\) can only be called while the container/);
  });

  it('recuerda qué injector creó cada instancia', () => {
    const injector = new Injector([Logger]);

    assert.equal(injectorOf(injector.get(Logger)), injector);
    assert.throws(() => injectorOf(new Logger()), /Logger was not created by the container/);
  });

  it('getOrInstantiate crea y reutiliza clases no registradas', () => {
    @Injectable()
    class AuditGuard {
      readonly logger = inject(Logger);
    }

    const injector = new Injector([Logger]);
    const guard = injector.getOrInstantiate(AuditGuard);

    assert.equal(injector.getOrInstantiate(AuditGuard), guard);
    assert.equal(guard.logger, injector.get(Logger));
  });
});
