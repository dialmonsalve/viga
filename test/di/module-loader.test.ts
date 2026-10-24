import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Controller } from '../../src/decorators/controller.ts';
import { Injectable } from '../../src/decorators/injectable.ts';
import { Module, type ModuleOptions } from '../../src/decorators/module.ts';
import { InjectionToken, inject } from '../../src/di/injector.ts';
import { loadApplication, loadModules } from '../../src/di/module-loader.ts';
import type { AnyConstructor } from '../../src/metadata.ts';

@Injectable()
class Database {}

@Module({ providers: [Database], exports: [Database] })
class DatabaseModule {}

@Module({ imports: [DatabaseModule], exports: [DatabaseModule] })
class CoreModule {}

@Injectable()
class Secret {}

@Module({ providers: [Secret] })
class SecretModule {}

function instantiateControllers(RootModule: AnyConstructor) {
  return loadModules(RootModule).map(({ controller, injector }) =>
    injector.instantiate(controller)
  );
}

describe('loadModules', () => {
  it('devuelve cada controlador con el injector de su módulo', () => {
    @Controller()
    class UsersController {
      readonly db = inject(Database);
    }

    @Module({ imports: [DatabaseModule], controllers: [UsersController] })
    class UsersModule {}

    const [controller] = instantiateControllers(UsersModule);

    assert.ok(controller instanceof UsersController);
    assert.ok(controller.db instanceof Database);
  });

  it('resuelve providers reexportados por otro módulo', () => {
    @Controller()
    class ReportsController {
      readonly db = inject(Database);
    }

    @Module({ imports: [CoreModule], controllers: [ReportsController] })
    class ReportsModule {}

    const [controller] = instantiateControllers(ReportsModule);

    assert.ok(controller instanceof ReportsController);
    assert.ok(controller.db instanceof Database);
  });

  it('comparte la instancia de un módulo importado por varios módulos', () => {
    @Controller()
    class BooksController {
      readonly db = inject(Database);
    }

    @Controller()
    class SalesController {
      readonly db = inject(Database);
    }

    @Module({ imports: [DatabaseModule], controllers: [BooksController] })
    class BooksModule {}

    @Module({ imports: [DatabaseModule], controllers: [SalesController] })
    class SalesModule {}

    @Module({ imports: [BooksModule, SalesModule] })
    class RootModule {}

    const [books, sales] = instantiateControllers(RootModule);

    assert.ok(books instanceof BooksController);
    assert.ok(sales instanceof SalesController);
    assert.equal(books.db, sales.db);
  });

  it('carga una sola vez un módulo importado desde varios sitios', () => {
    @Controller()
    class StockController {}

    @Module({ controllers: [StockController] })
    class StockModule {}

    @Module({ imports: [StockModule] })
    class InventoryModule {}

    @Module({ imports: [StockModule, InventoryModule] })
    class RootModule {}

    const controllers = loadModules(RootModule).map(({ controller }) => controller);

    assert.deepEqual(controllers, [StockController]);
  });

  it('no deja usar providers que el módulo importado no exporta', () => {
    @Controller()
    class LeakController {
      readonly secret = inject(Secret);
    }

    @Module({ imports: [SecretModule], controllers: [LeakController] })
    class LeakModule {}

    assert.throws(
      () => instantiateControllers(LeakModule),
      /LeakModule cannot resolve Secret/
    );
  });

  it('detecta importaciones circulares entre módulos', () => {
    const firstOptions: ModuleOptions = {};

    @Module(firstOptions)
    class FirstModule {}

    @Module({ imports: [FirstModule] })
    class SecondModule {}

    firstOptions.imports = [SecondModule];

    assert.throws(
      () => loadModules(FirstModule),
      /\[Module\] Circular import: FirstModule -> SecondModule -> FirstModule/
    );
  });

  it('exige @Module() en los módulos', () => {
    class NotAModule {}

    @Module({ imports: [NotAModule] })
    class RootModule {}

    assert.throws(() => loadModules(RootModule), /NotAModule must be decorated with @Module/);
  });

  it('expone los exports de un módulo global a todos los módulos sin importarlo', () => {
    @Injectable()
    class Clock {}

    @Module({ global: true, providers: [Clock], exports: [Clock] })
    class ClockModule {}

    @Controller()
    class ReportsController {
      readonly clock = inject(Clock);
    }

    @Module({ controllers: [ReportsController] })
    class ReportsModule {}

    @Module({ imports: [ReportsModule, ClockModule] })
    class RootModule {}

    const [reports] = instantiateControllers(RootModule);

    assert.ok(reports instanceof ReportsController);
    assert.ok(reports.clock instanceof Clock);
  });

  it('exige que un módulo global se importe en el módulo raíz', () => {
    @Module({ global: true })
    class ClockModule {}

    @Module({ imports: [ClockModule] })
    class ReportsModule {}

    @Module({ imports: [ReportsModule] })
    class RootModule {}

    assert.throws(
      () => loadModules(RootModule),
      /\[Module\] ClockModule is global and is imported from ReportsModule, but not from the root module; move it to the imports of RootModule/
    );
  });

  it('permite importar un módulo global también fuera del raíz si el raíz lo importa', () => {
    @Injectable()
    class Clock {}

    @Module({ global: true, providers: [Clock], exports: [Clock] })
    class ClockModule {}

    @Controller()
    class ReportsController {
      readonly clock = inject(Clock);
    }

    @Module({ imports: [ClockModule], controllers: [ReportsController] })
    class ReportsModule {}

    @Module({ imports: [ReportsModule, ClockModule] })
    class RootModule {}

    const [reports] = instantiateControllers(RootModule);

    assert.ok(reports instanceof ReportsController);
    assert.ok(reports.clock instanceof Clock);
  });

  it('acepta un módulo global como módulo raíz', () => {
    @Module({ global: true })
    class RootModule {}

    assert.deepEqual(loadModules(RootModule), []);
  });

  it('no expone lo que un módulo global no exporta', () => {
    @Injectable()
    class Hidden {}

    @Module({ global: true, providers: [Hidden] })
    class HiddenModule {}

    @Controller()
    class PeekController {
      readonly hidden = inject(Hidden);
    }

    @Module({ imports: [HiddenModule], controllers: [PeekController] })
    class RootModule {}

    assert.throws(() => instantiateControllers(RootModule), /RootModule cannot resolve Hidden/);
  });

  it('ofrece los providers de plataforma a todos los módulos', () => {
    const APP_NAME = new InjectionToken<string>('APP_NAME');

    @Controller()
    class InfoController {
      readonly name = inject(APP_NAME);
    }

    @Module({ controllers: [InfoController] })
    class InfoModule {}

    const { controllers } = loadApplication(InfoModule, {
      platformProviders: [{ provide: APP_NAME, useValue: 'viga' }],
    });
    const info = controllers[0]?.injector.instantiate(InfoController);

    assert.equal(info?.name, 'viga');
  });

  it('devuelve los injectors en orden de dependencias', () => {
    @Module({})
    class SharedModule {}

    @Module({ imports: [SharedModule] })
    class FeatureModule {}

    @Module({ imports: [FeatureModule] })
    class RootModule {}

    const { injectors } = loadApplication(RootModule);

    assert.deepEqual(
      injectors.map((injector) => injector.name),
      ['Platform', 'SharedModule', 'FeatureModule', 'RootModule']
    );
  });
});
