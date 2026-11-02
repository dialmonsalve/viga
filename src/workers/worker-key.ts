import { Module } from '../decorators/module.ts';
import { InjectionToken } from '../di/injector.ts';
import { diagnostic } from '../diagnostics.ts';

export const WORKER_KEY = new InjectionToken<string>('WORKER_KEY');

const KEY_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function assertWorkerKey(key: string) {
  if (!KEY_FORMAT.test(key)) throw new Error(diagnostic('workers.invalidKey', { key }));
}

export class WorkerModule {
  static forKey(key: string) {
    assertWorkerKey(key);

    @Module({
      global: true,
      providers: [{ provide: WORKER_KEY, useValue: key }],
      exports: [WORKER_KEY],
    })
    class WorkerKeyModule {}

    return WorkerKeyModule;
  }
}
