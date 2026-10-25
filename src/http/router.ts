import { Router, type Request, type Response } from 'express';
import { readControllerDefinition, type HttpMethod } from '../decorators/controller.ts';
import { resolveGuard, runGuards, type GuardFn } from '../decorators/use-guards.ts';
import {
  resolveInterceptor,
  runInterceptors,
  type InterceptorFn,
} from '../decorators/use-interceptors.ts';
import { handlerSteps, validatedParts } from '../decorators/pipeline.ts';
import { InjectionToken, type Injector } from '../di/injector.ts';
import type { AnyConstructor } from '../metadata.ts';
import { createContext, type HttpContext } from './context.ts';
import { UnauthorizedException } from './exceptions.ts';
import { diagnostic } from '../diagnostics.ts';

export const CONCEAL_ROUTES = new InjectionToken<boolean>('CONCEAL_ROUTES');

export interface MountedRoute {
  method: HttpMethod;
  path: string;
  isPublic: boolean;
}

export interface RoutePipeline {
  authGuard?: GuardFn;
  interceptors: InterceptorFn[];
  requireValidation?: boolean;
}

const METHODS_WITH_BODY: ReadonlySet<HttpMethod> = new Set(['post', 'put', 'patch']);

export async function authenticate(guard: GuardFn | undefined, ctx: HttpContext) {
  if (!guard || !(await guard(ctx))) throw new UnauthorizedException();
}

export function normalizePath(path: string) {
  return `/${path}`.replaceAll(/\/+/g, '/').replace(/(.)\/$/, '$1');
}

function defaultStatus(method: HttpMethod, result: unknown) {
  if (result === undefined) return 204;
  return method === 'post' ? 201 : 200;
}

export function mountController(
  parent: Router,
  ControllerClass: AnyConstructor,
  injector: Injector,
  pipeline: RoutePipeline = { interceptors: [] }
): MountedRoute[] {
  const definition = readControllerDefinition(ControllerClass);
  if (!definition) {
    throw new Error(diagnostic('router.notController', { name: ControllerClass.name }));
  }

  const instance = injector.instantiate(ControllerClass) as Record<PropertyKey, unknown>;
  const router = Router();
  const mounted: MountedRoute[] = [];
  const guards = definition.guards.map((guard) => resolveGuard(guard, injector));
  const interceptors = [
    ...pipeline.interceptors,
    ...definition.interceptors.map((ref) => resolveInterceptor(ref, injector)),
  ];

  for (const route of definition.routes) {
    const handler = instance[route.handlerName];
    if (typeof handler !== 'function') {
      throw new Error(
        diagnostic('router.notMethod', {
          controller: ControllerClass.name,
          method: String(route.handlerName),
        })
      );
    }

    const unvalidatedBody = pipeline.requireValidation && !validatedParts(handler).has('body');
    if (unvalidatedBody && METHODS_WITH_BODY.has(route.method)) {
      throw new Error(
        diagnostic('router.missingBodyValidation', {
          controller: ControllerClass.name,
          method: String(route.handlerName),
          verb: route.method.toUpperCase(),
        })
      );
    }

    const steps = handlerSteps(handler);
    const isPublic = definition.isPublic || definition.publicRoutes[route.handlerName] === true;
    mounted.push({
      method: route.method,
      path: normalizePath(`${definition.prefix}/${route.path}`),
      isPublic,
    });

    router[route.method](normalizePath(route.path), async (req: Request, res: Response) => {
      if (unvalidatedBody) req.body = undefined;
      const ctx = createContext(req, res);
      if (!isPublic) await authenticate(pipeline.authGuard, ctx);
      await runGuards(guards, ctx);
      await steps.guard(instance, ctx);

      const result = await runInterceptors(interceptors, ctx, () => steps.invoke(instance, ctx));
      if (res.headersSent) return;

      const status =
        definition.httpCodes[route.handlerName] ?? defaultStatus(route.method, result);

      if (result === undefined) {
        res.status(status).end();
      } else {
        res.status(status).json(result);
      }
    });
  }

  parent.use(normalizePath(definition.prefix), router);
  return mounted;
}
