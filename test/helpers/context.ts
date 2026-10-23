import type { Request, Response } from 'express';
import type { HttpContext } from '../../src/index.ts';

interface TestContextOptions {
  body?: unknown;
  query?: Record<string, string>;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

export function createTestContext({
  body,
  query = {},
  params = {},
  headers = {},
}: TestContextOptions = {}): HttpContext {
  const req = { body, query, params, headers } as unknown as Request;
  const res = {} as Response;
  return { req, res, body, query, params };
}
