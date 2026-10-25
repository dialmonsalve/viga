import { diagnostic } from '../diagnostics.ts';
import { createLimiter, type RateLimitOptions } from '../http/rate-limit.ts';
import { UseGuards, type GuardDecorator } from './use-guards.ts';

export function RateLimit(options: RateLimitOptions): GuardDecorator {
  const limit = createLimiter(options);
  return UseGuards(async ({ req, res }) => {
    if (!res) throw new Error(diagnostic('rateLimit.httpOnly'));
    await limit(req, res);
    return true;
  });
}
