import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { createContextKey } from '../context.ts';

export interface RequestIdOptions {
  header?: string;
  trustIncoming?: boolean;
  generate?: () => string;
}

export const REQUEST_ID = createContextKey<string>('requestId');

const SAFE_ID = /^[\w.-]{1,128}$/;

export function requestId({
  header = 'X-Request-Id',
  trustIncoming = false,
  generate = randomUUID,
}: RequestIdOptions = {}): RequestHandler {
  return (req, res, next) => {
    const incoming = trustIncoming ? req.get(header) : undefined;
    const id = incoming !== undefined && SAFE_ID.test(incoming) ? incoming : generate();
    REQUEST_ID.set(id);
    res.setHeader(header, id);
    next();
  };
}
