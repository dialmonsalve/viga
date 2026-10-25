import { readModuleOptions } from '../decorators/module.ts';
import type { AnyConstructor } from '../metadata.ts';
import { Injector, tokenName, type Provider, type Token } from './injector.ts';
import { diagnostic } from '../diagnostics.ts';

export interface LoadedController {
  controller: AnyConstructor;
  injector: Injector;
}

export interface LoadedApplication {
  controllers: LoadedController[];
  injectors: Injector[];
  root: Injector;
}

export interface LoadOptions {
  platformProviders?: Provider[];
  overrides?: Provider[];
}

function providerToken(provider: Provider): Token {
  return typeof provider === 'function' ? provider : provider.provide;
}

function createOverrider(overrides: Provider[]) {
  const byToken = new Map(overrides.map((provider) => [providerToken(provider), provider]));
  const used = new Set<Token>();

  return {
    apply(providers: Provider[]) {
      return providers.map((provider) => {
        const token = providerToken(provider);
        const override = byToken.get(token);
        if (!override) return provider;
        used.add(token);
        return override;
      });
    },
    assertAllUsed() {
      for (const token of byToken.keys()) {
        if (!used.has(token)) {
          throw new Error(diagnostic('testing.unknownOverride', { token: tokenName(token) }));
        }
      }
    },
  };
}

export function loadApplication(
  RootModule: AnyConstructor,
  { platformProviders = [], overrides = [] }: LoadOptions = {}
): LoadedApplication {
  const overrider = createOverrider(overrides);
  const injectors = new Map<AnyConstructor, Injector>();
  const loading: AnyConstructor[] = [];
  const controllers: LoadedController[] = [];
  const globals: Injector[] = [];
  const rootImports = readModuleOptions(RootModule)?.imports ?? [];

  const platform = new Injector(platformProviders, {
    name: 'Platform',
    exports: platformProviders.map(providerToken),
    globals,
  });
  globals.push(platform);

  function load(ModuleClass: AnyConstructor): Injector {
    const existing = injectors.get(ModuleClass);
    if (existing) return existing;

    if (loading.includes(ModuleClass)) {
      const chain = [...loading, ModuleClass].map((m) => m.name).join(' -> ');
      throw new Error(diagnostic('module.circularImport', { chain }));
    }

    const options = readModuleOptions(ModuleClass);
    if (!options) {
      throw new Error(diagnostic('module.notModule', { name: ModuleClass.name }));
    }

    if (options.global && ModuleClass !== RootModule && !rootImports.includes(ModuleClass)) {
      throw new Error(
        diagnostic('module.globalOutsideRoot', {
          name: ModuleClass.name,
          importer: loading.at(-1)!.name,
          root: RootModule.name,
        })
      );
    }

    loading.push(ModuleClass);
    const imports = (options.imports ?? []).map(load);
    loading.pop();

    const exports: Token[] = [];
    const reexports: Injector[] = [];
    for (const exported of options.exports ?? []) {
      if (typeof exported === 'function' && options.imports?.includes(exported)) {
        reexports.push(load(exported));
      } else {
        exports.push(exported);
      }
    }

    const injector = new Injector(overrider.apply(options.providers ?? []), {
      name: ModuleClass.name,
      imports,
      exports,
      reexports,
      globals,
    });
    injectors.set(ModuleClass, injector);
    if (options.global) globals.push(injector);

    for (const controller of options.controllers ?? []) {
      controllers.push({ controller, injector });
    }

    return injector;
  }

  const root = load(RootModule);
  overrider.assertAllUsed();
  return { controllers, injectors: [platform, ...injectors.values()], root };
}

export function loadModules(RootModule: AnyConstructor): LoadedController[] {
  return loadApplication(RootModule).controllers;
}
