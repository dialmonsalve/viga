import { Module } from '../decorators/module.ts';
import { EVENTS_OPTIONS, EventBus, type EventsOptions } from './event-bus.ts';

export class EventsModule {
  static forRoot(options: EventsOptions = {}) {
    @Module({
      global: true,
      providers: [{ provide: EVENTS_OPTIONS, useValue: options }, EventBus],
      exports: [EventBus],
    })
    class EventsRootModule {}

    return EventsRootModule;
  }
}
