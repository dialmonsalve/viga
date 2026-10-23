import './polyfills.ts';

export * from './decorators/index.ts';
export { App, createApp, type AppOptions } from './app.ts';
export { createContextKey, runInNewContext, type ContextKey } from './context.ts';
export {
  DIAGNOSTICS,
  setDiagnostics,
  type DiagnosticDictionary,
  type DiagnosticKey,
} from './diagnostics.ts';
export {
  inject,
  Injector,
  InjectionToken,
  type InjectorOptions,
  type Provider,
  type Token,
} from './di/injector.ts';
export type { OnModuleDestroy, OnModuleInit } from './di/lifecycle.ts';
export type { HttpContext, RequestSchemas } from './http/context.ts';
export * from './http/exceptions.ts';
export type { ApiErrorBody } from './http/error-handler.ts';
export type { MessageParams, MessageResolver } from './http/messages.ts';
export { LOGGER, silentLogger, type Logger } from './logger.ts';
export type { AnyConstructor } from './metadata.ts';
export type { StandardSchemaV1 } from './standard-schema.ts';
