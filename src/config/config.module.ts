import { Module } from '../decorators/module.ts';
import { InjectionToken } from '../di/injector.ts';
import { diagnostic } from '../diagnostics.ts';
import type { StandardSchemaV1 } from '../standard-schema.ts';

export interface Register {}

export type Config = Register extends { schema: infer S extends StandardSchemaV1 }
  ? StandardSchemaV1.InferOutput<S>
  : Record<string, unknown>;

export type ConfigSource = Readonly<Record<string, unknown>>;

export interface ConfigOptions {
  schema: StandardSchemaV1;
  env?: ConfigSource;
}

export const CONFIG = new InjectionToken<Config>('CONFIG');

const REDACTED = '***';

function keyOf(segment: PropertyKey | StandardSchemaV1.PathSegment) {
  return typeof segment === 'object' ? segment.key : segment;
}

function pathOf(issue: StandardSchemaV1.Issue) {
  const path = (issue.path ?? []).map((segment) => String(keyOf(segment))).join('.');
  return path || '(root)';
}

function valueAt(source: unknown, path: readonly (PropertyKey | StandardSchemaV1.PathSegment)[]) {
  let current = source;
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[keyOf(segment)];
  }
  return current;
}

function redact(message: string, issue: StandardSchemaV1.Issue, env: ConfigSource) {
  if (!issue.path?.length) return message;
  const value = valueAt(env, issue.path);
  if (typeof value !== 'string' && typeof value !== 'number') return message;
  const text = String(value);
  if (!text) return message;
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return message.replace(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'g'), REDACTED);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
  }
  return value;
}

function parseConfig({ schema, env = process.env }: ConfigOptions): Config {
  const result = schema['~standard'].validate(env);
  if (result instanceof Promise) throw new Error(diagnostic('config.asyncSchema'));

  if (result.issues) {
    const issues = result.issues
      .map((issue) => `  - ${pathOf(issue)}: ${redact(issue.message, issue, env)}`)
      .join('\n');
    throw new Error(diagnostic('config.invalid', { issues }));
  }
  return deepFreeze(result.value) as Config;
}

export class ConfigModule {
  static forRoot(options: ConfigOptions) {
    @Module({
      global: true,
      providers: [{ provide: CONFIG, useFactory: () => parseConfig(options) }],
      exports: [CONFIG],
    })
    class ConfigRootModule {}

    return ConfigRootModule;
  }
}
