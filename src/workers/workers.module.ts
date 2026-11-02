import { Module } from '../decorators/module.ts';
import { WORKERS_OPTIONS, WorkerSupervisor, type WorkersOptions } from './supervisor.ts';

export class WorkersModule {
  static forRoot(options: WorkersOptions | (() => WorkersOptions)) {
    const provider =
      typeof options === 'function'
        ? { provide: WORKERS_OPTIONS, useFactory: options }
        : { provide: WORKERS_OPTIONS, useValue: options };

    @Module({
      global: true,
      providers: [provider, WorkerSupervisor],
      exports: [WORKERS_OPTIONS, WorkerSupervisor],
    })
    class WorkersRootModule {}

    return WorkersRootModule;
  }
}
