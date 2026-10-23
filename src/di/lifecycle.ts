import { diagnostic } from '../diagnostics.ts';

export interface OnModuleInit {
  onModuleInit(): unknown;
}

export interface OnModuleDestroy {
  onModuleDestroy(): unknown;
}

function hasHook<K extends string>(value: unknown, hook: K): value is Record<K, () => unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)[hook] === 'function'
  );
}

export async function runInitHooks(instances: readonly unknown[]) {
  for (const instance of instances) {
    if (hasHook(instance, 'onModuleInit')) await instance.onModuleInit();
  }
}

export async function runDestroyHooks(instances: readonly unknown[]) {
  const errors: unknown[] = [];
  for (const instance of [...instances].reverse()) {
    if (!hasHook(instance, 'onModuleDestroy')) continue;
    try {
      await instance.onModuleDestroy();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, diagnostic('lifecycle.destroyFailed'));
  }
}
