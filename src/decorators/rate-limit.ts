import { createLimiter, type RateLimitOptions } from '../http/rate-limit.ts';
import { UseGuards, type GuardDecorator } from './use-guards.ts';

export function RateLimit(options: RateLimitOptions): GuardDecorator {
  const limit = createLimiter(options);
  return UseGuards(async ({ req, res }) => {
    await limit(req, res);
    return true;
  });
}
