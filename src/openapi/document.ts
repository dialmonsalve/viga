import { STATUS_CODES } from 'node:http';
import { isRateLimitGuard } from '../decorators/rate-limit.ts';
import { routeNotes } from '../decorators/pipeline.ts';
import { diagnostic } from '../diagnostics.ts';
import { normalizePath, type MountedRoute, type MountedRoutes } from '../http/router.ts';
import type { StandardSchemaV1 } from '../standard-schema.ts';
import { readDocs, type DocsResponse } from './docs.ts';

export type OpenApiSecurityScheme =
  | { type: 'http'; scheme: string; bearerFormat?: string; description?: string }
  | { type: 'apiKey'; name: string; in: 'query' | 'header' | 'cookie'; description?: string }
  | { type: 'oauth2'; flows: Record<string, unknown>; description?: string }
  | { type: 'openIdConnect'; openIdConnectUrl: string; description?: string };

export interface OpenApiOptions {
  title: string;
  version: string;
  description?: string;
  securitySchemes?: Readonly<Record<string, OpenApiSecurityScheme>>;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes?: Record<string, OpenApiSecurityScheme>;
  };
}

type JsonSchema = Record<string, unknown>;
type Side = 'input' | 'output';
type Warn = (message: string) => void;

const API_ERROR: JsonSchema = {
  type: 'object',
  required: ['statusCode', 'code', 'message', 'error', 'timestamp'],
  properties: {
    statusCode: { type: 'integer' },
    code: { type: 'string' },
    message: { type: 'string' },
    error: { type: 'string' },
    details: {},
    requestId: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
  },
};

const errorContent = {
  'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function converterOf(schema: StandardSchemaV1, side: Side) {
  const standard: unknown = schema['~standard'];
  if (!isRecord(standard) || !isRecord(standard.jsonSchema)) return undefined;

  const convert = standard.jsonSchema[side];
  return typeof convert === 'function' ? convert : undefined;
}

function toJsonSchema(
  schema: StandardSchemaV1,
  sides: readonly [Side, Side],
  route: string,
  part: string,
  warn: Warn
): JsonSchema {
  if (!converterOf(schema, sides[0])) {
    warn(diagnostic('openapi.noJsonSchema', { route, part }));
    return {};
  }

  let reason = '';
  for (const side of sides) {
    try {
      const result: unknown = converterOf(schema, side)?.({ target: 'draft-2020-12' });
      if (isRecord(result)) {
        const { $schema: _version, ...rest } = result;
        return rest;
      }
    } catch (error) {
      reason ||= error instanceof Error ? error.message : String(error);
    }
  }

  warn(diagnostic('openapi.unconvertible', { route, part, reason }));
  return {};
}

function toOpenApiPath(path: string) {
  return path
    .replaceAll(/[{}]/g, '')
    .replaceAll(/[:*]([\w$]+)/g, '{$1}');
}

function pathParameters(path: string) {
  return [...path.matchAll(/[:*]([\w$]+)/g)].flatMap(([, name]) => (name ? [name] : []));
}

function propertiesOf(schema: JsonSchema) {
  return isRecord(schema.properties) ? schema.properties : {};
}

function requiredOf(schema: JsonSchema) {
  return Array.isArray(schema.required) ? schema.required : [];
}

function hasDefault(schema: unknown) {
  return isRecord(schema) && 'default' in schema;
}

function responseOf(code: number, response: DocsResponse, route: string, warn: Warn) {
  const description = typeof response === 'string' ? response : (STATUS_CODES[code] ?? 'Response');
  if (typeof response !== 'string') {
    const schema = toJsonSchema(response, ['output', 'input'], route, `response ${code}`, warn);
    return { description, content: { 'application/json': { schema } } };
  }
  return code >= 400 ? { description, content: errorContent } : { description };
}

function errorResponse(code: number) {
  return { description: STATUS_CODES[code] ?? 'Error', content: errorContent };
}

function successStatus(route: MountedRoute) {
  return route.source?.httpCode ?? (route.method === 'post' ? 201 : 200);
}

function buildRequestBody(route: MountedRoute, name: string, warn: Warn) {
  const { schemas, upload } = routeNotes(route.source?.handler);
  const body = schemas?.body && toJsonSchema(schemas.body, ['input', 'output'], name, 'body', warn);

  if (!upload) {
    return body && { required: true, content: { 'application/json': { schema: body } } };
  }

  const file = { type: 'string', format: 'binary' };
  const required = [...requiredOf(body ?? {}), ...(upload.optional ? [] : [upload.field])];
  return {
    required: !upload.optional,
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          properties: {
            ...propertiesOf(body ?? {}),
            [upload.field]: upload.multiple ? { type: 'array', items: file } : file,
          },
          ...(required.length > 0 ? { required } : {}),
        },
      },
    },
  };
}

function buildParameters(route: MountedRoute, name: string, warn: Warn) {
  const { schemas } = routeNotes(route.source?.handler);
  const sides = ['output', 'input'] as const;
  const params = schemas?.params ? toJsonSchema(schemas.params, sides, name, 'params', warn) : {};
  const query = schemas?.query ? toJsonSchema(schemas.query, sides, name, 'query', warn) : {};
  const declared = propertiesOf(params);

  return [
    ...pathParameters(route.path).map((parameter) => ({
      name: parameter,
      in: 'path',
      required: true,
      schema: declared[parameter] ?? { type: 'string' },
    })),
    ...Object.entries(propertiesOf(query)).map(([parameter, schema]) => ({
      name: parameter,
      in: 'query',
      required: requiredOf(query).includes(parameter) && !hasDefault(schema),
      schema,
    })),
  ];
}

function buildResponses(route: MountedRoute, name: string, warn: Warn) {
  const { source } = route;
  const notes = routeNotes(source?.handler);
  const { responses = {} } = source ? readDocs(source.controller, source.handlerName) : {};
  const documented = Object.entries(responses);
  const guards = [...(source?.guards ?? []), ...(notes.guards ?? [])];
  const generated: Record<string, unknown> = {};

  if (!documented.some(([code]) => code.startsWith('2'))) {
    const status = successStatus(route);
    generated[status] = { description: STATUS_CODES[status] ?? 'Success' };
  }
  if (Object.keys(notes.schemas ?? {}).length > 0 || notes.upload) generated[400] = errorResponse(400);
  if (!route.isPublic) generated[401] = errorResponse(401);
  if (notes.upload) {
    generated[413] = errorResponse(413);
    generated[415] = errorResponse(415);
  }
  if (guards.some(isRateLimitGuard)) generated[429] = errorResponse(429);

  return {
    ...generated,
    ...Object.fromEntries(
      documented.map(([code, response]) => [code, responseOf(Number(code), response, name, warn)])
    ),
  };
}

function tagFromController(name: string) {
  return name.replace(/Controller$/, '') || name;
}

export function buildDocument(
  options: OpenApiOptions,
  { prefix, routes }: MountedRoutes,
  warn: Warn
): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {};
  const operationIds = new Map<string, number>();
  const schemes = Object.keys(options.securitySchemes ?? {});

  for (const route of routes) {
    const { source } = route;
    if (!source) continue;

    const docs = readDocs(source.controller, source.handlerName);
    if (docs.hidden) continue;

    const fullPath = normalizePath(`${prefix}/${route.path}`);
    const name = `${route.method.toUpperCase()} ${fullPath}`;
    const baseId = `${source.controller.name}_${String(source.handlerName)}`;
    const seen = (operationIds.get(baseId) ?? 0) + 1;
    operationIds.set(baseId, seen);

    const parameters = buildParameters({ ...route, path: fullPath }, name, warn);
    const requestBody = buildRequestBody(route, name, warn);

    (paths[toOpenApiPath(fullPath)] ??= {})[route.method] = {
      operationId: seen === 1 ? baseId : `${baseId}_${seen}`,
      tags: docs.tags ?? [tagFromController(source.controller.name)],
      ...(docs.summary ? { summary: docs.summary } : {}),
      ...(docs.description ? { description: docs.description } : {}),
      ...(docs.deprecated ? { deprecated: true } : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses: buildResponses(route, name, warn),
      ...(schemes.length > 0
        ? { security: route.isPublic ? [] : schemes.map((scheme) => ({ [scheme]: [] })) }
        : {}),
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.title,
      version: options.version,
      ...(options.description ? { description: options.description } : {}),
    },
    paths,
    components: {
      schemas: { ApiError: API_ERROR },
      ...(options.securitySchemes ? { securitySchemes: { ...options.securitySchemes } } : {}),
    },
  };
}
