import { Module } from '../decorators/module.ts';
import { InjectionToken } from '../di/injector.ts';
import type { StandardSchemaV1 } from '../standard-schema.ts';

export interface ValidationOptions {
  formatIssue?: (issue: StandardSchemaV1.Issue) => string | undefined;
}

export const VALIDATION_OPTIONS = new InjectionToken<ValidationOptions>('VALIDATION_OPTIONS');

export class ValidationModule {
  static forRoot(options: ValidationOptions) {
    @Module({
      global: true,
      providers: [{ provide: VALIDATION_OPTIONS, useValue: options }],
      exports: [VALIDATION_OPTIONS],
    })
    class ValidationRootModule {}

    return ValidationRootModule;
  }
}
