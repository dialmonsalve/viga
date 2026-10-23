import { injectorOf } from '../di/injector.ts';
import { DatabaseService, type TransactionConfig } from './database.service.ts';

export function Transactional(config?: TransactionConfig) {
  return function <This extends object, M extends (this: This, ...args: any[]) => Promise<unknown>>(
    method: M,
    _context: ClassMethodDecoratorContext<This, M>
  ) {
    return function (this: This, ...args: unknown[]) {
      const database = injectorOf(this).get(DatabaseService);
      return database.transaction(() => method.apply(this, args), config);
    } as M;
  };
}
