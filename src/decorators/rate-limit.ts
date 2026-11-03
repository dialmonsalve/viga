import { diagnostic } from '../diagnostics.ts';
import type { HttpContext } from '../http/context.ts';
import { createLimiter, type RateLimitOptions } from '../http/rate-limit.ts';
import { UseGuards, type GuardDecorator } from './use-guards.ts';

const RATE_LIMIT_GUARDS = new WeakSet<object>();

export function isRateLimitGuard(guard: unknown) {
  return typeof guard === 'function' && RATE_LIMIT_GUARDS.has(guard);
}

export function RateLimit(options: RateLimitOptions): GuardDecorator {
  const limit = createLimiter(options);
  const guard = async ({ req, res }: HttpContext) => {
    if (!res) throw new Error(diagnostic('rateLimit.httpOnly'));
    await limit(req, res);
    return true;
  };

  RATE_LIMIT_GUARDS.add(guard);
  return UseGuards(guard);
}
