import { Router, type Request, type Response } from 'express';
import { readControllerDefinition, type HttpMethod, type RouteDefinition } from '../decorators/controller.ts';
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
import { BadRequestException, UnauthorizedException } from './exceptions.ts';
import { diagnostic } from '../diagnostics.ts';
import type { Logger } from '../logger.ts';

export const CONCEAL_ROUTES = new InjectionToken<boolean>('CONCEAL_ROUTES');

export interface RouteSource {
  controller: AnyConstructor;
  handler: unknown;
  handlerName: string | symbol;
  httpCode: number | undefined;
  guards: readonly unknown[];
}

export interface MountedRoute {
  method: HttpMethod;
  path: string;
  isPublic: boolean;
  source?: RouteSource;
}

export interface MountedRoutes {
  prefix: string;
  routes: readonly MountedRoute[];
}

export const MOUNTED_ROUTES = new InjectionToken<() => MountedRoutes>('MOUNTED_ROUTES');

export interface RoutePipeline {
  authGuard?: GuardFn;
  interceptors: InterceptorFn[];
  requireValidation?: boolean;
  parseBody?: (req: Request, res: Response) => Promise<void>;
}

export async function authenticate(guard: GuardFn | undefined, ctx: HttpContext) {
  if (!guard || !(await guard(ctx))) throw new UnauthorizedException();
}

function hasBody(req: Request) {
  const length = req.headers['content-length'];
  return req.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0');
}

export function normalizePath(path: string) {
  return `/${path}`.replaceAll(/\/+/g, '/').replace(/(.)\/$/, '$1');
}

const SEGMENT_RANK = { fixed: 0, mixed: 1, param: 2, wildcard: 3 } as const;

function segmentsOf(path: string) {
  return normalizePath(path).split('/').filter(Boolean);
}

function rankOf(segment: string) {
  if (segment.includes('*')) return SEGMENT_RANK.wildcard;
  if (/^:[\w$]+$/.test(segment)) return SEGMENT_RANK.param;
  return /[:{}]/.test(segment) ? SEGMENT_RANK.mixed : SEGMENT_RANK.fixed;
}

function compareSpecificity(a: string, b: string) {
  const left = segmentsOf(a);
  const right = segmentsOf(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = rankOf(left[i] ?? '') - rankOf(right[i] ?? '');
    if (difference !== 0) return difference;
  }
  return 0;
}

function sortRoutes(routes: readonly RouteDefinition[]) {
  return [...routes].sort((a, b) => compareSpecificity(a.path, b.path));
}

function shapeOf(path: string) {
  return normalizePath(path)
    .replaceAll(/:[\w$]+/g, ':')
    .replaceAll(/\*[\w$]+/g, '*')
    .toLowerCase();
}

function shadows(earlier: string, later: string) {
  const first = shapeOf(earlier).split('/').filter(Boolean);
  const second = shapeOf(later).split('/').filter(Boolean);
  const wildcard = first.findIndex((segment) => segment === '*');
  const compared = wildcard === -1 ? first : first.slice(0, wildcard);

  if (wildcard === -1 ? first.length !== second.length : second.length < compared.length) return false;
  return compared.every((segment, index) => segment === ':' || segment === second[index]);
}

function describeRoute({ method, path }: MountedRoute) {
  return `${method.toUpperCase()} ${path}`;
}

export function checkRoutes(routes: readonly MountedRoute[], logger: Logger) {
  const shapes = new Map<string, MountedRoute>();

  for (const route of routes) {
    const shape = `${route.method} ${shapeOf(route.path)}`;
    const existing = shapes.get(shape);
    if (existing) {
      throw new Error(
        diagnostic('router.duplicateRoute', { first: describeRoute(existing), second: describeRoute(route) })
      );
    }
    shapes.set(shape, route);
  }

  routes.forEach((later, index) => {
    const earlier = routes.slice(0, index).find((route) => route.method === later.method && shadows(route.path, later.path));
    if (earlier) {
      logger.warn(
        diagnostic('router.shadowedRoute', { earlier: describeRoute(earlier), later: describeRoute(later) })
      );
    }
  });
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

  for (const route of sortRoutes(definition.routes)) {
    const handler = instance[route.handlerName];
    if (typeof handler !== 'function') {
      throw new Error(
        diagnostic('router.notMethod', {
          controller: ControllerClass.name,
          method: String(route.handlerName),
        })
      );
    }

    const parts = validatedParts(handler);
    const unvalidatedBody = pipeline.requireValidation && !parts.has('body') && !parts.has('upload');
    const steps = handlerSteps(handler);
    const isPublic = definition.isPublic || definition.publicRoutes[route.handlerName] === true;
    mounted.push({
      method: route.method,
      path: normalizePath(`${definition.prefix}/${route.path}`),
      isPublic,
      source: {
        controller: ControllerClass,
        handler,
        handlerName: route.handlerName,
        httpCode: definition.httpCodes[route.handlerName],
        guards: definition.guards,
      },
    });

    router[route.method](normalizePath(route.path), async (req: Request, res: Response) => {
      const ctx = createContext(req, res);
      if (!isPublic) await authenticate(pipeline.authGuard, ctx);

      if (unvalidatedBody) {
        if (hasBody(req)) throw new BadRequestException('errors.unexpectedBody');
        req.body = undefined;
      } else {
        await pipeline.parseBody?.(req, res);
      }
      ctx.body = req.body;

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
