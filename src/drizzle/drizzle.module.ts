import { Module } from '../decorators/module.ts';
import { DRIZZLE_OPTIONS, DatabaseService, type DrizzleOptions } from './database.service.ts';

export class DrizzleModule {
  static forRoot(options: DrizzleOptions) {
    @Module({
      global: true,
      providers: [{ provide: DRIZZLE_OPTIONS, useValue: options }, DatabaseService],
      exports: [DRIZZLE_OPTIONS, DatabaseService],
    })
    class DrizzleRootModule {}

    return DrizzleRootModule;
  }
}
