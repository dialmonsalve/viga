import { UseGuards, type GuardDecorator } from '../decorators/use-guards.ts';
import { createCounter, type RateLimitStore } from '../http/rate-limit.ts';
import type { WsContext } from './gateway.ts';
import { tooManyMessages } from './errors.ts';

export interface WsRateLimitOptions {
  max: number;
  windowMs: number;
  key?: (ctx: WsContext) => string;
  store?: RateLimitStore;
}

const byConnection = (ctx: WsContext) => ctx.client.id;

export function RateLimit({ key = byConnection, ...options }: WsRateLimitOptions): GuardDecorator {
  const count = createCounter(options);
  return UseGuards(async (ctx: WsContext) => {
    const { limited, resetSeconds } = await count(key(ctx));
    if (limited) throw tooManyMessages(resetSeconds);
    return true;
  });
}
