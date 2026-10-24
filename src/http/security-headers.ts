import type { RequestHandler } from 'express';

export type SecurityHeaders = Record<string, string | false>;

export const DEFAULT_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

export function securityHeaders(overrides: SecurityHeaders = {}): RequestHandler {
  const merged: SecurityHeaders = { ...DEFAULT_SECURITY_HEADERS };
  for (const [name, value] of Object.entries(overrides)) {
    const existing = Object.keys(merged).find((key) => key.toLowerCase() === name.toLowerCase());
    if (existing) delete merged[existing];
    merged[name] = value;
  }

  const headers = Object.entries(merged).filter(
    (entry): entry is [string, string] => entry[1] !== false
  );

  return (_req, res, next) => {
    for (const [name, value] of headers) res.setHeader(name, value);
    next();
  };
}
