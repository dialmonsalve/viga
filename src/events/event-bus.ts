import { hasDetachedValue, runDetached } from '../context.ts';
import { Injectable } from '../decorators/injectable.ts';
import { InjectionToken, inject } from '../di/injector.ts';
import { PROVIDER_INSTANCES, type OnDrain } from '../di/lifecycle.ts';
import { diagnostic } from '../diagnostics.ts';
import { LOGGER } from '../logger.ts';
import { readListeners } from './on-event.ts';

export interface EventsOptions {
  drainTimeoutMs?: number;
}

export const EVENTS_OPTIONS = new InjectionToken<EventsOptions>('EVENTS_OPTIONS');

interface Listener {
  name: string;
  handle(event: object): unknown;
}

const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;

@Injectable()
export class EventBus implements OnDrain {
  private readonly logger = inject(LOGGER);
  private readonly instances = inject(PROVIDER_INSTANCES);
  private readonly drainTimeoutMs = inject(EVENTS_OPTIONS).drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  private readonly listeners = new Map<unknown, Listener[]>();
  private readonly pending = new Set<Promise<void>>();
  private scanned = 0;
  private warnedTransaction = false;

  constructor() {
    if (!Number.isInteger(this.drainTimeoutMs) || this.drainTimeoutMs <= 0) {
      throw new Error(diagnostic('events.invalidOptions', { drainTimeoutMs: this.drainTimeoutMs }));
    }
  }

  emit(event: object): Promise<void> {
    if (!this.warnedTransaction && hasDetachedValue()) {
      this.warnedTransaction = true;
      this.logger.warn(diagnostic('events.emittedInTransaction', { event: event.constructor.name }));
    }

    this.scan();
    const running = Promise.all(
      (this.listeners.get(event.constructor) ?? []).map((listener) => this.run(listener, event))
    ).then(() => undefined);

    this.pending.add(running);
    void running.finally(() => this.pending.delete(running));
    return running;
  }

  async onDrain() {
    if (this.pending.size === 0) return;

    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), this.drainTimeoutMs);
    });

    let expired = false;
    while (this.pending.size > 0 && !expired) {
      expired = await Promise.race([Promise.all(this.pending).then(() => false), timedOut]);
    }
    clearTimeout(timer);

    if (expired) {
      this.logger.error(
        diagnostic('events.drainTimedOut', { count: this.pending.size, drainTimeoutMs: this.drainTimeoutMs })
      );
    }
  }

  private run({ name, handle }: Listener, event: object) {
    return runDetached(async () => {
      try {
        await Promise.resolve();
        await handle(event);
      } catch (error) {
        this.logger.error(
          diagnostic('events.listenerFailed', { listener: name, event: event.constructor.name }),
          error
        );
      }
    });
  }

  private scan() {
    const instances = this.instances();
    for (const instance of instances.slice(this.scanned)) {
      if (typeof instance !== 'object' || instance === null) continue;

      for (const { Event, handlerName } of readListeners(instance.constructor)) {
        const listeners = this.listeners.get(Event) ?? [];
        listeners.push({
          name: `${instance.constructor.name}.${String(handlerName)}`,
          handle: (event) => Reflect.apply(Reflect.get(instance, handlerName), instance, [event]),
        });
        this.listeners.set(Event, listeners);
      }
    }
    this.scanned = instances.length;
  }
}
