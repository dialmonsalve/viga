import { injectorOf, type Injector } from '../di/injector.ts';
import { ForbiddenException } from '../http/exceptions.ts';
import type { HttpContext } from '../http/context.ts';
import { GUARDS, ownList, type AnyConstructor } from '../metadata.ts';
import { addToPipeline } from './pipeline.ts';

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

export async function runGuards(guards: GuardFn[], ctx: HttpContext) {
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

export function UseGuards(...guards: Guard[]): GuardDecorator {
  return function (
    target: Handler<object>,
    context: ClassDecoratorContext | ClassMethodDecoratorContext
  ) {
    if (context.kind === 'class') {
      ownList<Guard>(context.metadata, GUARDS).push(...guards);
      return;
    }

    return addToPipeline(target, {
      guards: [
        async (self, ctx) => {
          const injector = injectorOf(self);
          await runGuards(guards.map((guard) => resolveGuard(guard, injector)), ctx);
        },
      ],
    });
  } as GuardDecorator;
}
