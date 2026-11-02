import { Module } from '../decorators/module.ts';
import { DRIZZLE_OPTIONS, DatabaseService, type DrizzleOptions } from './database.service.ts';

export class DrizzleModule {
  static forRoot(options: DrizzleOptions | (() => DrizzleOptions)) {
    const provider =
      typeof options === 'function'
        ? { provide: DRIZZLE_OPTIONS, useFactory: options }
        : { provide: DRIZZLE_OPTIONS, useValue: options };

    @Module({
      global: true,
      providers: [provider, DatabaseService],
      exports: [DRIZZLE_OPTIONS, DatabaseService],
    })
    class DrizzleRootModule {}

    return DrizzleRootModule;
  }
}
