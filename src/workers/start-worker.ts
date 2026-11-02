import { PLATFORM_PROVIDERS, createApp, type App, type AppOptions } from '../app.ts';
import { diagnostic } from '../diagnostics.ts';
import type { AnyConstructor } from '../metadata.ts';
import { WORKER_KEY, assertWorkerKey } from './worker-key.ts';

export interface StartWorkerOptions extends Omit<AppOptions, 'rootModule'> {
  key?: string;
  orphanTimeoutMs?: number;
}

const DEFAULT_ORPHAN_TIMEOUT_MS = 30_000;

function closeWithParent(app: App, timeoutMs: number) {
  if (!process.send) return;
  if (!process.connected) process.exit(0);

  process.once('disconnect', () => {
    setTimeout(() => process.exit(1), timeoutMs).unref();
    app.close().then(
      () => process.exit(0),
      () => process.exit(1)
    );
  });
}

export async function startWorker(
  rootModule: AnyConstructor,
  { key = process.argv[2], orphanTimeoutMs = DEFAULT_ORPHAN_TIMEOUT_MS, ...options }: StartWorkerOptions = {}
): Promise<App> {
  if (key === undefined) throw new Error(diagnostic('workers.missingKey'));
  assertWorkerKey(key);

  const app = createApp({ ...options, rootModule }).enableShutdownHooks();
  app[PLATFORM_PROVIDERS] = [{ provide: WORKER_KEY, useValue: key }];
  closeWithParent(app, orphanTimeoutMs);

  try {
    await app.init();
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
  return app;
}
