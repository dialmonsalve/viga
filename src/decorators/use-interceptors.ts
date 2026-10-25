import { injectorOf, type Injector } from '../di/injector.ts';
import type { HttpContext } from '../http/context.ts';
import { INTERCEPTORS, ownList, type AnyConstructor } from '../metadata.ts';
import { diagnostic } from '../diagnostics.ts';
import { addToPipeline } from './pipeline.ts';

export type CallHandler = () => Promise<unknown>;

export interface Interceptor<C = HttpContext> {
  intercept(ctx: C, next: CallHandler): unknown;
}

export type InterceptorFn<C = HttpContext> = (ctx: C, next: CallHandler) => unknown;

export type InterceptorRef<C = HttpContext> = AnyConstructor<Interceptor<C>> | InterceptorFn<C>;

function isInterceptorClass<C>(ref: InterceptorRef<C>): ref is AnyConstructor<Interceptor<C>> {
  return typeof ref.prototype?.intercept === 'function';
}

export function resolveInterceptor<C>(ref: InterceptorRef<C>, injector: Injector): InterceptorFn<C> {
  if (!isInterceptorClass(ref)) return ref;
  const instance = injector.getOrInstantiate(ref);
  return (ctx, next) => instance.intercept(ctx, next);
}

export function runInterceptors<C>(
  interceptors: InterceptorFn<C>[],
  ctx: C,
  handler: CallHandler
): Promise<unknown> {
  const dispatch = async (index: number): Promise<unknown> => {
    const interceptor = interceptors[index];
    if (!interceptor) return handler();

    let called = false;
    return interceptor(ctx, () => {
      if (called) {
        return Promise.reject(new Error(diagnostic('interceptor.nextCalledTwice')));
      }
      called = true;
      return dispatch(index + 1);
    });
  };

  return dispatch(0);
}

type Handler<This> = (this: This, ...args: any) => any;

interface InterceptorDecorator {
  (target: AnyConstructor, context: ClassDecoratorContext): void;
  <This extends object, M extends Handler<This>>(
    method: M,
    context: ClassMethodDecoratorContext<This, M>
  ): M;
}

export function UseInterceptors<C = HttpContext>(
  ...refs: InterceptorRef<C>[]
): InterceptorDecorator {
  return function (
    target: Handler<object>,
    context: ClassDecoratorContext | ClassMethodDecoratorContext
  ) {
    if (context.kind === 'class') {
      ownList<InterceptorRef<C>>(context.metadata, INTERCEPTORS).push(...refs);
      return;
    }

    return addToPipeline(target, {
      interceptors: [
        (self, ctx, next) => {
          const injector = injectorOf(self);
          const interceptors = refs.map((ref) => resolveInterceptor(ref, injector));
          return runInterceptors(interceptors, ctx as C, next);
        },
      ],
    });
  } as InterceptorDecorator;
}
