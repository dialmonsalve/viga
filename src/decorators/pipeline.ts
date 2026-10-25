export type GuardStep = (self: object, ctx: object) => Promise<void>;

export type InterceptorStep = (
  self: object,
  ctx: object,
  next: () => Promise<unknown>
) => Promise<unknown>;

export type PipeStep = (self: object, ctx: object) => Promise<object>;

interface Pipeline {
  target: (this: object, ctx: object) => unknown;
  guards: GuardStep[];
  interceptors: InterceptorStep[];
  pipes: PipeStep[];
  validated: Set<string>;
}

type Steps = Partial<Omit<Pipeline, 'validated' | 'target'>> & { validates?: string[] };

const PIPELINE = Symbol('pipeline');

type Handler = ((this: object, ctx: object) => unknown) & { [PIPELINE]?: Pipeline };

export interface HandlerSteps {
  guard(self: object, ctx: object): Promise<void>;
  invoke(self: object, ctx: object): Promise<unknown>;
}

export function validatedParts(method: unknown): ReadonlySet<string> {
  return (method as Handler | undefined)?.[PIPELINE]?.validated ?? new Set();
}

async function runGuardSteps(pipeline: Pipeline, self: object, ctx: object) {
  for (const guard of pipeline.guards) await guard(self, ctx);
}

function invokeSteps(pipeline: Pipeline, self: object, ctx: object) {
  const dispatch = async (index: number): Promise<unknown> => {
    const interceptor = pipeline.interceptors[index];
    if (interceptor) return interceptor(self, ctx, () => dispatch(index + 1));

    let current = ctx;
    for (const pipe of pipeline.pipes) current = await pipe(self, current);
    return pipeline.target.call(self, current);
  };
  return dispatch(0);
}

export function handlerSteps(method: unknown): HandlerSteps {
  const handler = method as Handler;
  const pipeline = handler[PIPELINE];
  if (!pipeline) {
    return {
      guard: async () => undefined,
      invoke: async (self, ctx) => handler.call(self, ctx),
    };
  }
  return {
    guard: (self, ctx) => runGuardSteps(pipeline, self, ctx),
    invoke: (self, ctx) => invokeSteps(pipeline, self, ctx),
  };
}

export function addToPipeline<M>(method: M, steps: Steps): M {
  const handler = method as Handler;
  const existing = handler[PIPELINE];
  const pipeline: Pipeline = existing ?? {
    target: handler,
    guards: [],
    interceptors: [],
    pipes: [],
    validated: new Set(),
  };

  pipeline.guards.unshift(...(steps.guards ?? []));
  pipeline.interceptors.unshift(...(steps.interceptors ?? []));
  pipeline.pipes.unshift(...(steps.pipes ?? []));
  for (const part of steps.validates ?? []) pipeline.validated.add(part);

  if (existing) return method;

  const wrapped: Handler = async function (this: object, ctx: object) {
    await runGuardSteps(pipeline, this, ctx);
    return invokeSteps(pipeline, this, ctx);
  };
  wrapped[PIPELINE] = pipeline;
  return wrapped as M;
}
