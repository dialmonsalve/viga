import { InjectionToken, inject } from '../di/injector.ts';
import { Injectable } from '../decorators/injectable.ts';
import { diagnostic } from '../diagnostics.ts';
import { LOGGER } from '../logger.ts';

export type HealthCheck = () => unknown;

export interface HealthOptions {
  checks?: Record<string, HealthCheck>;
  timeoutMs?: number;
  cacheMs?: number;
}

export const HEALTH_OPTIONS = new InjectionToken<HealthOptions>('HEALTH_OPTIONS');

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_MS = 1_000;

function validate(timeoutMs: number, cacheMs: number) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(cacheMs) || cacheMs < 0) {
    throw new Error(diagnostic('health.invalidOptions', { timeoutMs, cacheMs }));
  }
}

@Injectable()
export class HealthService {
  private readonly logger = inject(LOGGER);
  private readonly options = inject(HEALTH_OPTIONS);
  private readonly timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  private readonly cacheMs = this.options.cacheMs ?? DEFAULT_CACHE_MS;
  private last?: { ready: boolean; expiresAt: number };
  private running?: Promise<boolean>;

  constructor() {
    validate(this.timeoutMs, this.cacheMs);
  }

  async isReady(): Promise<boolean> {
    if (this.last && this.last.expiresAt > Date.now()) return this.last.ready;

    this.running ??= this.runChecks().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async runChecks() {
    const checks = Object.entries(this.options.checks ?? {});
    const results = await Promise.all(checks.map(([name, check]) => this.passes(name, check)));
    const ready = results.every(Boolean);
    this.last = { ready, expiresAt: Date.now() + this.cacheMs };
    return ready;
  }

  private async passes(name: string, check: HealthCheck) {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(diagnostic('health.checkTimedOut', { timeoutMs: this.timeoutMs }))),
        this.timeoutMs
      );
    });

    try {
      const result = await Promise.race([Promise.resolve().then(check), timeout]);
      if (result === false) throw new Error(diagnostic('health.checkReturnedFalse'));
      return true;
    } catch (error) {
      this.logger.error(diagnostic('health.checkFailed', { name }), error);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
