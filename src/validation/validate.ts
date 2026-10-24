import { addToPipeline } from '../decorators/pipeline.ts';
import { findInjectorOf } from '../di/injector.ts';
import type { HttpContext, RequestSchemas } from '../http/context.ts';
import { BadRequestException } from '../http/exceptions.ts';
import { VALIDATION_OPTIONS, type ValidationOptions } from './validation.module.ts';
import type { StandardSchemaV1 } from '../standard-schema.ts';

const PARTS = ['body', 'query', 'params'] as const;

export interface ValidationIssue {
  path: string;
  code?: string;
  message: string;
}

export type ValidationErrors = Partial<Record<(typeof PARTS)[number], ValidationIssue[]>>;

function pathOf(issue: StandardSchemaV1.Issue) {
  return (issue.path ?? [])
    .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.');
}

function codeOf(issue: StandardSchemaV1.Issue) {
  const { code } = issue as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

function toValidationIssue(
  issue: StandardSchemaV1.Issue,
  options: ValidationOptions | undefined
): ValidationIssue {
  const code = codeOf(issue);
  return {
    path: pathOf(issue),
    ...(code === undefined ? {} : { code }),
    message: options?.formatIssue?.(issue) ?? issue.message,
  };
}

async function parseRequest<S extends RequestSchemas>(
  schemas: S,
  ctx: HttpContext,
  options: ValidationOptions | undefined
): Promise<HttpContext<S>> {
  const parsed: Record<string, unknown> = { ...ctx };
  const errors: ValidationErrors = {};

  for (const part of PARTS) {
    const schema = schemas[part];
    if (!schema) continue;

    const result = await schema['~standard'].validate(ctx[part]);
    if (result.issues) {
      errors[part] = result.issues.map((issue) => toValidationIssue(issue, options));
    } else {
      parsed[part] = result.value;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new BadRequestException('errors.validation', errors);
  }

  return parsed as unknown as HttpContext<S>;
}

export function Validate<const S extends RequestSchemas>(schemas: S) {
  return function <This extends object, M extends (this: This, ctx: HttpContext<S>) => unknown>(
    method: M,
    _context: ClassMethodDecoratorContext<This, M>
  ) {
    return addToPipeline(method, {
      validates: PARTS.filter((part) => schemas[part] !== undefined),
      pipes: [
        (self, ctx) => {
          const options = findInjectorOf(self)?.find(VALIDATION_OPTIONS);
          return parseRequest(schemas, ctx, options) as Promise<HttpContext>;
        },
      ],
    });
  };
}
