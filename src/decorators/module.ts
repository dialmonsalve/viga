import type { Provider, Token } from '../di/injector.ts';
import { MODULE, readOwn, type AnyConstructor } from '../metadata.ts';

export interface ModuleOptions {
  imports?: AnyConstructor[];
  controllers?: AnyConstructor[];
  providers?: Provider[];
  exports?: Token[];
  global?: boolean;
}

export function Module(options: ModuleOptions) {
  return function (_target: AnyConstructor, context: ClassDecoratorContext) {
    context.metadata[MODULE] = options;
  };
}

export function readModuleOptions(target: AnyConstructor) {
  return readOwn<ModuleOptions>(target, MODULE);
}
