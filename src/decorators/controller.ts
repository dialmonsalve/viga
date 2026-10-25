import {
  CONTROLLER,
  GUARDS,
  HTTP_CODES,
  INTERCEPTORS,
  PUBLIC,
  ROUTES,
  isPublicHandler,
  ownList,
  ownRecord,
  readMetadata,
  readOwn,
  type AnyConstructor,
} from '../metadata.ts';
import type { Guard } from './use-guards.ts';
import type { InterceptorRef } from './use-interceptors.ts';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  handlerName: string | symbol;
}

export interface ControllerDefinition {
  prefix: string;
  routes: RouteDefinition[];
  httpCodes: Record<PropertyKey, number>;
  isPublic: boolean;
  publicRoutes: Record<PropertyKey, boolean>;
  guards: Guard[];
  interceptors: InterceptorRef[];
}

export function Controller(prefix = '') {
  return function (_target: AnyConstructor, context: ClassDecoratorContext) {
    context.metadata[CONTROLLER] = prefix;
  };
}

function createRouteDecorator(method: HttpMethod) {
  return function (path = '') {
    return function (_method: unknown, context: ClassMethodDecoratorContext) {
      ownList<RouteDefinition>(context.metadata, ROUTES).push({
        method,
        path,
        handlerName: context.name,
      });
    };
  };
}

export const Get = createRouteDecorator('get');
export const Post = createRouteDecorator('post');
export const Put = createRouteDecorator('put');
export const Patch = createRouteDecorator('patch');
export const Delete = createRouteDecorator('delete');

export function HttpCode(code: number) {
  return function (_method: unknown, context: ClassMethodDecoratorContext) {
    ownRecord<number>(context.metadata, HTTP_CODES)[context.name] = code;
  };
}

export function readControllerDefinition(
  target: AnyConstructor
): ControllerDefinition | undefined {
  const prefix = readOwn<string>(target, CONTROLLER);
  if (prefix === undefined) return undefined;

  const metadata = readMetadata(target);
  const routes = (metadata[ROUTES] as RouteDefinition[] | undefined) ?? [];
  return {
    prefix,
    routes,
    httpCodes: (metadata[HTTP_CODES] as Record<PropertyKey, number> | undefined) ?? {},
    isPublic: readOwn<boolean>(target, PUBLIC) === true,
    publicRoutes: Object.fromEntries(
      routes.map((route) => [route.handlerName, isPublicHandler(target, route.handlerName)])
    ),
    guards: (metadata[GUARDS] as Guard[] | undefined) ?? [],
    interceptors: (metadata[INTERCEPTORS] as InterceptorRef[] | undefined) ?? [],
  };
}
