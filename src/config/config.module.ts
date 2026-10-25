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
const MIN_REDACTED_LENGTH = 4;

function pathOf(issue: StandardSchemaV1.Issue) {
  const path = (issue.path ?? [])
    .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.');
  return path || '(root)';
}

function redact(message: string, issue: StandardSchemaV1.Issue, env: ConfigSource) {
  const [first] = issue.path ?? [];
  const key = typeof first === 'object' ? first.key : first;
  const value = key === undefined ? undefined : env[String(key)];
  if (typeof value !== 'string' || value.length < MIN_REDACTED_LENGTH) return message;
  return message.replaceAll(value, REDACTED);
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
  return Object.freeze(result.value) as Config;
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
