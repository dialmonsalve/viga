import type { Request, RequestHandler } from 'express';
import { diagnostic } from '../diagnostics.ts';
import { ForbiddenException } from './exceptions.ts';

export interface CsrfOptions {
  trustedOrigins?: readonly string[];
}

const SIMPLE_CONTENT_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
]);

function isOrigin(value: string) {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

function needsNoPreflight(req: Request) {
  if (req.method !== 'POST') return false;
  const type = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  return !type || SIMPLE_CONTENT_TYPES.has(type);
}

function hostOf(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return undefined;
  }
}

function isCrossOrigin(req: Request) {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined) return site !== 'same-origin' && site !== 'none';

  const { origin } = req.headers;
  if (origin === undefined) return false;
  return hostOf(origin) !== req.host;
}

export function csrfProtection({ trustedOrigins = [] }: CsrfOptions = {}): RequestHandler {
  for (const origin of trustedOrigins) {
    if (!isOrigin(origin)) throw new Error(diagnostic('app.invalidTrustedOrigin', { origin }));
  }
  const trusted = new Set(trustedOrigins);

  return (req, _res, next) => {
    if (!needsNoPreflight(req) || !isCrossOrigin(req)) return next();
    const { origin } = req.headers;
    if (origin !== undefined && trusted.has(origin)) return next();
    next(new ForbiddenException('errors.crossSiteRequest'));
  };
}
