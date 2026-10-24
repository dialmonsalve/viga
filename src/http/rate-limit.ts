import type { Request, RequestHandler, Response } from 'express';
import { diagnostic } from '../diagnostics.ts';
import { TooManyRequestsException } from './exceptions.ts';

export interface RateLimitHit {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): RateLimitHit | Promise<RateLimitHit>;
}

export interface RateLimitOptions {
  max: number;
  windowMs: number;
  key?: (req: Request) => string;
  store?: RateLimitStore;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, RateLimitHit>();
  private lastSweep = Date.now();

  hit(key: string, windowMs: number): RateLimitHit {
    const now = Date.now();
    if (now - this.lastSweep >= windowMs) this.sweep(now);

    const current = this.hits.get(key);
    if (current && current.resetAt > now) {
      current.count++;
      return { ...current };
    }

    const fresh = { count: 1, resetAt: now + windowMs };
    this.hits.set(key, fresh);
    return { ...fresh };
  }

  private sweep(now: number) {
    for (const [key, hit] of this.hits) {
      if (hit.resetAt <= now) this.hits.delete(key);
    }
    this.lastSweep = now;
  }
}

const byIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';

function isPositiveInteger(value: number) {
  return Number.isInteger(value) && value > 0;
}

export function createLimiter({
  max,
  windowMs,
  key = byIp,
  store = new MemoryRateLimitStore(),
}: RateLimitOptions) {
  if (!isPositiveInteger(max) || !isPositiveInteger(windowMs)) {
    throw new Error(diagnostic('rateLimit.invalidOptions', { max, windowMs }));
  }

  return async (req: Request, res: Response) => {
    const { count, resetAt } = await store.hit(key(req), windowMs);
    const reset = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - count)));
    res.setHeader('RateLimit-Reset', String(reset));

    if (count > max) {
      res.setHeader('Retry-After', String(reset));
      throw new TooManyRequestsException();
    }
  };
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const limit = createLimiter(options);
  return (req, res, next) => {
    limit(req, res).then(() => next(), next);
  };
}
