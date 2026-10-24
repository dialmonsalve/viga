import { injectorOf, type Injector } from '../di/injector.ts';
import type { HttpContext } from '../http/context.ts';
import { INTERCEPTORS, ownList, type AnyConstructor } from '../metadata.ts';
import { diagnostic } from '../diagnostics.ts';
import { addToPipeline } from './pipeline.ts';

export type CallHandler = () => Promise<unknown>;

export interface Interceptor {
  intercept(ctx: HttpContext, next: CallHandler): unknown;
}

export type InterceptorFn = (ctx: HttpContext, next: CallHandler) => unknown;

export type InterceptorRef = AnyConstructor<Interceptor> | InterceptorFn;

function isInterceptorClass(ref: InterceptorRef): ref is AnyConstructor<Interceptor> {
  return typeof ref.prototype?.intercept === 'function';
}

export function resolveInterceptor(ref: InterceptorRef, injector: Injector): InterceptorFn {
  if (!isInterceptorClass(ref)) return ref;
  const instance = injector.getOrInstantiate(ref);
  return (ctx, next) => instance.intercept(ctx, next);
}

export function runInterceptors(
  interceptors: InterceptorFn[],
  ctx: HttpContext,
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

export function UseInterceptors(...refs: InterceptorRef[]): InterceptorDecorator {
  return function (
    target: Handler<object>,
    context: ClassDecoratorContext | ClassMethodDecoratorContext
  ) {
    if (context.kind === 'class') {
      ownList<InterceptorRef>(context.metadata, INTERCEPTORS).push(...refs);
      return;
    }

    return addToPipeline(target, {
      interceptors: [
        (self, ctx, next) => {
          const injector = injectorOf(self);
          const interceptors = refs.map((ref) => resolveInterceptor(ref, injector));
          return runInterceptors(interceptors, ctx, next);
        },
      ],
    });
  } as InterceptorDecorator;
}
