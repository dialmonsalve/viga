import type { Server } from 'node:http';
import { diagnostic } from '../diagnostics.ts';
import { InjectionToken } from './injector.ts';

export interface OnModuleInit {
  onModuleInit(): unknown;
}

export interface OnModuleDestroy {
  onModuleDestroy(): unknown;
}

export interface OnServerListen {
  onServerListen(server: Server): unknown;
}

export interface OnServerClose {
  onServerClose(): unknown;
}

export const PROVIDER_INSTANCES = new InjectionToken<() => readonly unknown[]>(
  'PROVIDER_INSTANCES'
);

function hasHook<K extends string>(
  value: unknown,
  hook: K
): value is Record<K, (...args: unknown[]) => unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)[hook] === 'function'
  );
}

export async function runInitHooks(instances: readonly unknown[], initialized: unknown[] = []) {
  for (const instance of instances) {
    if (hasHook(instance, 'onModuleInit')) await instance.onModuleInit();
    initialized.push(instance);
  }
}

export async function runServerListenHooks(instances: readonly unknown[], server: Server) {
  for (const instance of instances) {
    if (hasHook(instance, 'onServerListen')) await instance.onServerListen(server);
  }
}

async function runReverseHooks(
  instances: readonly unknown[],
  hook: 'onModuleDestroy' | 'onServerClose',
  failure: 'lifecycle.destroyFailed' | 'lifecycle.serverCloseFailed'
) {
  const errors: unknown[] = [];
  for (const instance of [...instances].reverse()) {
    if (!hasHook(instance, hook)) continue;
    try {
      await instance[hook]();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, diagnostic(failure));
  }
}

export function runServerCloseHooks(instances: readonly unknown[]) {
  return runReverseHooks(instances, 'onServerClose', 'lifecycle.serverCloseFailed');
}

export function runDestroyHooks(instances: readonly unknown[]) {
  return runReverseHooks(instances, 'onModuleDestroy', 'lifecycle.destroyFailed');
}
