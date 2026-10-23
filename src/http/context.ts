import type { Request, Response } from 'express';
import type { StandardSchemaV1 } from '../standard-schema.ts';

export interface RequestSchemas {
  body?: StandardSchemaV1;
  query?: StandardSchemaV1;
  params?: StandardSchemaV1;
}

type Parsed<S, K extends keyof RequestSchemas, Fallback> = S extends {
  [P in K]: infer Schema extends StandardSchemaV1;
}
  ? StandardSchemaV1.InferOutput<Schema>
  : Fallback;

export interface HttpContext<S extends RequestSchemas = RequestSchemas> {
  req: Request;
  res: Response;
  body: Parsed<S, 'body', unknown>;
  query: Parsed<S, 'query', Request['query']>;
  params: Parsed<S, 'params', Request['params']>;
}

export function createContext(req: Request, res: Response): HttpContext {
  return {
    req,
    res,
    body: req.body,
    query: req.query,
    params: req.params,
  };
}
