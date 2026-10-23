import type { RequestHandler } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { diagnostic } from './diagnostics.ts';

type Scope = Map<symbol, unknown>;

const storage = new AsyncLocalStorage<Scope>();

export interface ContextKey<T> {
  readonly description: string;
  get(): T;
  find(): T | undefined;
  run<R>(value: T, fn: () => R): R;
  set(value: T): void;
}

export function createContextKey<T>(description: string): ContextKey<T> {
  const id = Symbol(description);

  return {
    description,

    find() {
      return storage.getStore()?.get(id) as T | undefined;
    },

    get() {
      const scope = storage.getStore();
      if (!scope?.has(id)) {
        throw new Error(diagnostic('context.missingValue', { key: description }));
      }
      return scope.get(id) as T;
    },

    run(value, fn) {
      const scope = new Map(storage.getStore());
      scope.set(id, value);
      return storage.run(scope, fn);
    },

    set(value) {
      const scope = storage.getStore();
      if (!scope) {
        throw new Error(diagnostic('context.setOutsideScope', { key: description }));
      }
      scope.set(id, value);
    },
  };
}

export function runInNewContext<R>(fn: () => R): R {
  return storage.run(new Map(), fn);
}

export const contextMiddleware: RequestHandler = (_req, _res, next) => {
  runInNewContext(next);
};
