import { injectorOf, type Injector } from '../di/injector.ts';
import { ForbiddenException } from '../http/exceptions.ts';
import type { HttpContext } from '../http/context.ts';
import type { AnyConstructor } from '../metadata.ts';

export interface CanActivate {
  canActivate(ctx: HttpContext): boolean | Promise<boolean>;
}

export type GuardFn = (ctx: HttpContext) => boolean | Promise<boolean>;

export type Guard = AnyConstructor<CanActivate> | GuardFn;

function isGuardClass(guard: Guard): guard is AnyConstructor<CanActivate> {
  return typeof guard.prototype?.canActivate === 'function';
}

export function resolveGuard(guard: Guard, injector: Injector): GuardFn {
  if (!isGuardClass(guard)) return guard;
  const instance = injector.getOrInstantiate(guard);
  return (ctx) => instance.canActivate(ctx);
}

type Handler<This> = (this: This, ...args: any) => any;

export function UseGuards(...guards: Guard[]) {
  return function <This extends object, M extends Handler<This>>(
    method: M,
    _context: ClassMethodDecoratorContext<This, M>
  ) {
    return async function (this: This, ctx: HttpContext) {
      const injector = injectorOf(this);

      for (const guard of guards) {
        const allowed = await resolveGuard(guard, injector)(ctx);
        if (!allowed) throw new ForbiddenException();
      }

      return method.call(this, ctx);
    } as unknown as M;
  };
}
