import type { Request, RequestHandler, Response } from 'express';
import { createHash } from 'node:crypto';
import { diagnostic } from '../diagnostics.ts';
import { TooManyRequestsException } from './exceptions.ts';
import { ipKey } from './ip.ts';

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

const SATURATED = Number.MAX_SAFE_INTEGER;

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly single = new Map<string, RateLimitHit>();
  private readonly repeated = new Map<string, RateLimitHit>();
  private readonly maxKeys: number;
  private lastSweep = Date.now();
  private nextExpiry = Number.POSITIVE_INFINITY;

  constructor({ maxKeys = 10_000 }: MemoryRateLimitStoreOptions = {}) {
    if (!isPositiveInteger(maxKeys)) {
      throw new Error(diagnostic('rateLimit.invalidMaxKeys', { maxKeys }));
    }
    this.maxKeys = maxKeys;
  }

  get size() {
    return this.single.size + this.repeated.size;
  }

  hit(rawKey: string, windowMs: number): RateLimitHit {
    const key = compactKey(rawKey);
    const now = Date.now();
    if (now - this.lastSweep >= windowMs) this.sweep(now);

    const live = this.repeated.get(key);
    if (live && live.resetAt > now) {
      live.count++;
      return { ...live };
    }

    const first = this.single.get(key);
    if (first && first.resetAt > now) {
      this.single.delete(key);
      first.count++;
      this.repeated.set(key, first);
      return { ...first };
    }

    this.single.delete(key);
    this.repeated.delete(key);
    if (this.size >= this.maxKeys && !this.makeRoom(now)) {
      return { count: SATURATED, resetAt: this.nextExpiry };
    }

    const fresh = { count: 1, resetAt: now + windowMs };
    this.single.set(key, fresh);
    this.nextExpiry = Math.min(this.nextExpiry, fresh.resetAt);
    return { ...fresh };
  }

  private makeRoom(now: number) {
    const oldest = this.single.keys().next().value;
    if (oldest !== undefined) {
      this.single.delete(oldest);
      return true;
    }
    if (now >= this.nextExpiry) this.sweep(now);
    return this.size < this.maxKeys;
  }

  private sweep(now: number) {
    let nextExpiry = Number.POSITIVE_INFINITY;
    for (const hits of [this.single, this.repeated]) {
      for (const [key, hit] of hits) {
        if (hit.resetAt <= now) hits.delete(key);
        else nextExpiry = Math.min(nextExpiry, hit.resetAt);
      }
    }
    this.lastSweep = now;
    this.nextExpiry = nextExpiry;
  }
}

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  resetSeconds: number;
}

export interface CounterOptions {
  max: number;
  windowMs: number;
  store?: RateLimitStore;
}

export function secondsUntil(timestamp: number) {
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

export function createCounter({ max, windowMs, store = new MemoryRateLimitStore() }: CounterOptions) {
  if (!isPositiveInteger(max) || !isPositiveInteger(windowMs)) {
    throw new Error(diagnostic('rateLimit.invalidOptions', { max, windowMs }));
  }

  return async (key: string): Promise<RateLimitResult> => {
    const { count, resetAt } = await store.hit(key, windowMs);
    return {
      limited: count > max,
      remaining: Math.max(0, max - count),
      resetSeconds: secondsUntil(resetAt),
    };
  };
}

const byIp = (req: Request) => ipKey(req.ip ?? req.socket.remoteAddress ?? 'unknown');

export function createLimiter({ key = byIp, ...options }: RateLimitOptions) {
  const count = createCounter(options);

  return async (req: Request, res: Response) => {
    const { limited, remaining, resetSeconds } = await count(key(req));

    res.setHeader('RateLimit-Limit', String(options.max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));

    if (limited) {
      res.setHeader('Retry-After', String(resetSeconds));
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
