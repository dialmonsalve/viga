import type { IncomingMessage } from 'node:http';
import { addToPipeline } from '../decorators/pipeline.ts';
import type { Guard } from '../decorators/use-guards.ts';
import type { InterceptorRef } from '../decorators/use-interceptors.ts';
import { findInjectorOf } from '../di/injector.ts';
import { diagnostic } from '../diagnostics.ts';
import { BadRequestException } from '../http/exceptions.ts';
import { normalizePath } from '../http/router.ts';
import {
  GUARDS,
  INJECTABLE,
  INTERCEPTORS,
  PUBLIC,
  ownList,
  readMetadata,
  readOwn,
  type AnyConstructor,
} from '../metadata.ts';
import type { StandardSchemaV1 } from '../standard-schema.ts';
import { toValidationIssue } from '../validation/validate.ts';
import { VALIDATION_OPTIONS } from '../validation/validation.module.ts';

export interface WsClient {
  readonly id: string;
  readonly state: Record<string, unknown>;
  readonly rooms: ReadonlySet<string>;
  readonly locale: string | undefined;
  send(event: string, data?: unknown): void;
  join(room: string): void;
  leave(room: string): void;
  close(code?: number, reason?: string): void;
}

type InferData<S> = S extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<S> : unknown;

export interface WsContext<S extends StandardSchemaV1 | undefined = undefined> {
  client: WsClient;
  req: IncomingMessage;
  event: string;
  data: InferData<S>;
}

export interface OnWsConnection {
  onConnection(client: WsClient): unknown;
}

export interface OnWsDisconnect {
  onDisconnect(client: WsClient, code: number, reason: string): unknown;
}

export interface MessageHandlerDefinition {
  event: string;
  handlerName: string | symbol;
}

export interface GatewayDefinition {
  path: string;
  isPublic: boolean;
  handlers: MessageHandlerDefinition[];
  guards: Guard<WsContext>[];
  interceptors: InterceptorRef<WsContext>[];
}

const GATEWAY = Symbol('gateway');
const MESSAGE_HANDLERS = Symbol('messageHandlers');
const EVENT_NAME = /^[\w.:-]{1,128}$/;

export function Gateway(path: string) {
  return function (_target: AnyConstructor, context: ClassDecoratorContext) {
    context.metadata[GATEWAY] = normalizePath(path);
    context.metadata[INJECTABLE] = true;
  };
}

async function parseData(
  schema: StandardSchemaV1,
  self: object,
  ctx: WsContext
): Promise<WsContext> {
  const result = await schema['~standard'].validate(ctx.data);
  if (result.issues) {
    const options = findInjectorOf(self)?.find(VALIDATION_OPTIONS);
    throw new BadRequestException('errors.validation', {
      data: result.issues.map((issue) => toValidationIssue(issue, options)),
    });
  }
  return { ...ctx, data: result.value };
}

export function OnMessage<const S extends StandardSchemaV1 | undefined = undefined>(
  event: string,
  schema?: S
) {
  if (!EVENT_NAME.test(event)) {
    throw new Error(diagnostic('ws.invalidEvent', { event }));
  }

  return function <
    This extends object,
    M extends (this: This, ctx: WsContext & { data: InferData<S> }) => unknown,
  >(
    method: M,
    context: ClassMethodDecoratorContext<This, M>
  ): M {
    ownList<MessageHandlerDefinition>(context.metadata, MESSAGE_HANDLERS).push({
      event,
      handlerName: context.name,
    });
    if (!schema) return method;

    return addToPipeline(method, {
      validates: ['data'],
      pipes: [(self, ctx) => parseData(schema, self, ctx as WsContext)],
    });
  };
}

export function readGatewayDefinition(target: AnyConstructor): GatewayDefinition | undefined {
  const path = readOwn<string>(target, GATEWAY);
  if (path === undefined) return undefined;

  const metadata = readMetadata(target);
  return {
    path,
    isPublic: metadata[PUBLIC] === true,
    handlers: (metadata[MESSAGE_HANDLERS] as MessageHandlerDefinition[] | undefined) ?? [],
    guards: (metadata[GUARDS] as Guard<WsContext>[] | undefined) ?? [],
    interceptors: (metadata[INTERCEPTORS] as InterceptorRef<WsContext>[] | undefined) ?? [],
  };
}
