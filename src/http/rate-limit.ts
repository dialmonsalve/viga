import type { Request, RequestHandler, Response } from 'express';
import { createHash } from 'node:crypto';
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

function isPositiveInteger(value: number) {
  return Number.isInteger(value) && value > 0;
}

export interface MemoryRateLimitStoreOptions {
  maxKeys?: number;
}

const MAX_KEY_LENGTH = 128;

function compactKey(key: string) {
  return key.length > MAX_KEY_LENGTH
    ? `#${createHash('sha256').update(key).digest('base64')}`
    : `=${key}`;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, RateLimitHit>();
  private readonly maxKeys: number;
  private lastSweep = Date.now();

  constructor({ maxKeys = 10_000 }: MemoryRateLimitStoreOptions = {}) {
    if (!isPositiveInteger(maxKeys)) {
      throw new Error(diagnostic('rateLimit.invalidMaxKeys', { maxKeys }));
    }
    this.maxKeys = maxKeys;
  }

  get size() {
    return this.hits.size;
  }

  hit(rawKey: string, windowMs: number): RateLimitHit {
    const key = compactKey(rawKey);
    const now = Date.now();
    if (now - this.lastSweep >= windowMs) this.sweep(now);

    const current = this.hits.get(key);
    if (current && current.resetAt > now) {
      current.count++;
      return { ...current };
    }

    if (!current && this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
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
