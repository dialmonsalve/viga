import { injectorOf, type Injector } from '../di/injector.ts';
import { ForbiddenException } from '../http/exceptions.ts';
import type { HttpContext } from '../http/context.ts';
import { GUARDS, ownList, type AnyConstructor } from '../metadata.ts';
import { addToPipeline } from './pipeline.ts';

export interface CanActivate<C = HttpContext> {
  canActivate(ctx: C): boolean | Promise<boolean>;
}

export type GuardFn<C = HttpContext> = (ctx: C) => boolean | Promise<boolean>;

export type Guard<C = HttpContext> = AnyConstructor<CanActivate<C>> | GuardFn<C>;

function isGuardClass<C>(guard: Guard<C>): guard is AnyConstructor<CanActivate<C>> {
  return typeof guard.prototype?.canActivate === 'function';
}

export function resolveGuard<C>(guard: Guard<C>, injector: Injector): GuardFn<C> {
  if (!isGuardClass(guard)) return guard;
  const instance = injector.getOrInstantiate(guard);
  return (ctx) => instance.canActivate(ctx);
}

export async function runGuards<C>(guards: GuardFn<C>[], ctx: C) {
  for (const guard of guards) {
    if (!(await guard(ctx))) throw new ForbiddenException();
  }
}

type Handler<This> = (this: This, ...args: any) => any;

export interface GuardDecorator {
  (target: AnyConstructor, context: ClassDecoratorContext): void;
  <This extends object, M extends Handler<This>>(
    method: M,
    context: ClassMethodDecoratorContext<This, M>
  ): M;
}

export function UseGuards<C = HttpContext>(...guards: Guard<C>[]): GuardDecorator {
  return function (
    target: Handler<object>,
    context: ClassDecoratorContext | ClassMethodDecoratorContext
  ) {
    if (context.kind === 'class') {
      ownList<Guard<C>>(context.metadata, GUARDS).push(...guards);
      return;
    }

    return addToPipeline(target, {
      guards: [
        async (self, ctx) => {
          const injector = injectorOf(self);
          await runGuards(guards.map((guard) => resolveGuard(guard, injector)), ctx as C);
        },
      ],
    });
  } as GuardDecorator;
}
