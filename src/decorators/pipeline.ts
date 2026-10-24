import type { HttpContext } from '../http/context.ts';

export type GuardStep = (self: object, ctx: HttpContext) => Promise<void>;

export type InterceptorStep = (
  self: object,
  ctx: HttpContext,
  next: () => Promise<unknown>
) => Promise<unknown>;

export type PipeStep = (self: object, ctx: HttpContext) => Promise<HttpContext>;

interface Pipeline {
  guards: GuardStep[];
  interceptors: InterceptorStep[];
  pipes: PipeStep[];
  validated: Set<string>;
}

type Steps = Partial<Omit<Pipeline, 'validated'>> & { validates?: string[] };

const PIPELINE = Symbol('pipeline');

type Handler = ((this: object, ctx: HttpContext) => unknown) & { [PIPELINE]?: Pipeline };

export function validatedParts(method: unknown): ReadonlySet<string> {
  return (method as Handler | undefined)?.[PIPELINE]?.validated ?? new Set();
}

export function addToPipeline<M>(method: M, steps: Steps): M {
  const handler = method as Handler;
  const existing = handler[PIPELINE];
  const pipeline = existing ?? { guards: [], interceptors: [], pipes: [], validated: new Set() };

  pipeline.guards.unshift(...(steps.guards ?? []));
  pipeline.interceptors.unshift(...(steps.interceptors ?? []));
  pipeline.pipes.unshift(...(steps.pipes ?? []));
  for (const part of steps.validates ?? []) pipeline.validated.add(part);

  if (existing) return method;

  const wrapped: Handler = async function (this: object, ctx: HttpContext) {
    for (const guard of pipeline.guards) await guard(this, ctx);

    const dispatch = async (index: number): Promise<unknown> => {
      const interceptor = pipeline.interceptors[index];
      if (interceptor) return interceptor(this, ctx, () => dispatch(index + 1));

      let current = ctx;
      for (const pipe of pipeline.pipes) current = await pipe(this, current);
      return handler.call(this, current);
    };

    return dispatch(0);
  };
  wrapped[PIPELINE] = pipeline;
  return wrapped as M;
}
