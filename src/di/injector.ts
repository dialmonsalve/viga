import { INJECTABLE, readMetadata, type AnyConstructor } from '../metadata.ts';
import { diagnostic } from '../diagnostics.ts';

export class InjectionToken<T> {
  declare readonly type?: T;

  constructor(readonly description: string) {}

  toString() {
    return `InjectionToken(${this.description})`;
  }
}

export type Token<T = unknown> = AnyConstructor<T> | InjectionToken<T>;

export type Provider<T = unknown> =
  | AnyConstructor<T>
  | { provide: Token<T>; useClass: AnyConstructor<T> }
  | { provide: Token<T>; useValue: T }
  | { provide: Token<T>; useFactory: () => T };

export interface InjectorOptions {
  name?: string;
  imports?: Injector[];
  exports?: Token[];
  reexports?: Injector[];
  globals?: readonly Injector[];
}

const NOT_FOUND = Symbol('NOT_FOUND');
const owners = new WeakMap<object, Injector>();
let current: Injector | null = null;

export function tokenName(token: Token): string {
  return typeof token === 'function' ? token.name : String(token);
}

export function inject<T>(token: Token<T>): T {
  if (!current) {
    throw new Error(diagnostic('di.injectOutsideContainer', { token: tokenName(token) }));
  }
  return current.get(token);
}

export function findInjectorOf(instance: object): Injector | undefined {
  return owners.get(instance);
}

export function injectorOf(instance: object): Injector {
  const injector = owners.get(instance);
  if (!injector) {
    throw new Error(diagnostic('di.notCreatedByContainer', { name: instance.constructor.name }));
  }
  return injector;
}

function assertInjectable(Class: AnyConstructor) {
  if (!readMetadata(Class)[INJECTABLE]) {
    throw new Error(diagnostic('di.notInjectable', { name: Class.name }));
  }
}

export class Injector {
  readonly name: string;
  private readonly factories = new Map<Token, () => unknown>();
  private readonly instances = new Map<Token, unknown>();
  private readonly resolving = new Set<Token>();
  private readonly imports: Injector[];
  private readonly exported: Set<Token>;
  private readonly reexports: Injector[];
  private readonly globals: readonly Injector[];

  constructor(providers: Provider[] = [], options: InjectorOptions = {}) {
    this.name = options.name ?? 'Injector';
    this.imports = options.imports ?? [];
    this.exported = new Set(options.exports);
    this.reexports = options.reexports ?? [];
    this.globals = options.globals ?? [];

    for (const provider of providers) this.register(provider);
  }

  get<T>(token: Token<T>): T {
    const value = this.lookup(token);
    if (value === NOT_FOUND) {
      throw new Error(
        diagnostic('di.cannotResolve', { injector: this.name, token: tokenName(token) })
      );
    }
    return value as T;
  }

  find<T>(token: Token<T>): T | undefined {
    const value = this.lookup(token);
    return value === NOT_FOUND ? undefined : (value as T);
  }

  instantiate<T>(Class: AnyConstructor<T>): T {
    return this.runInContext(() => this.construct(Class));
  }

  getOrInstantiate<T>(Class: AnyConstructor<T>): T {
    const value = this.lookup(Class);
    if (value !== NOT_FOUND) return value as T;

    const instance = this.instantiate(Class);
    this.instances.set(Class, instance);
    return instance;
  }

  resolveAll(): unknown[] {
    for (const token of this.factories.keys()) this.get(token);
    return [...this.instances.values()];
  }

  private register(provider: Provider) {
    if (typeof provider === 'function') {
      assertInjectable(provider);
      this.factories.set(provider, () => this.construct(provider));
    } else if ('useClass' in provider) {
      const { useClass } = provider;
      assertInjectable(useClass);
      this.factories.set(provider.provide, () => this.construct(useClass));
    } else if ('useValue' in provider) {
      const { useValue } = provider;
      this.factories.set(provider.provide, () => useValue);
    } else {
      this.factories.set(provider.provide, provider.useFactory);
    }
  }

  private lookup(token: Token): unknown {
    const local = this.lookupLocal(token);
    if (local !== NOT_FOUND) return local;

    for (const global of this.globals) {
      if (global === this) continue;
      const value = global.lookupExported(token);
      if (value !== NOT_FOUND) return value;
    }
    return NOT_FOUND;
  }

  private lookupLocal(token: Token): unknown {
    if (this.instances.has(token)) return this.instances.get(token);

    const factory = this.factories.get(token);
    if (factory) return this.create(token, factory);

    for (const imported of this.imports) {
      const value = imported.lookupExported(token);
      if (value !== NOT_FOUND) return value;
    }
    return NOT_FOUND;
  }

  private lookupExported(token: Token): unknown {
    if (this.exported.has(token)) return this.lookupLocal(token);

    for (const module of this.reexports) {
      const value = module.lookupExported(token);
      if (value !== NOT_FOUND) return value;
    }
    return NOT_FOUND;
  }

  private create(token: Token, factory: () => unknown): unknown {
    if (this.resolving.has(token)) {
      const chain = [...this.resolving, token].map(tokenName).join(' -> ');
      throw new Error(diagnostic('di.circularDependency', { injector: this.name, chain }));
    }

    this.resolving.add(token);
    try {
      const instance = this.runInContext(factory);
      this.instances.set(token, instance);
      return instance;
    } finally {
      this.resolving.delete(token);
    }
  }

  private construct<T>(Class: AnyConstructor<T>): T {
    const instance = new Class();
    owners.set(instance as object, this);
    return instance;
  }

  private runInContext<T>(fn: () => T): T {
    const previous = current;
    current = this;
    try {
      return fn();
    } finally {
      current = previous;
    }
  }
}
