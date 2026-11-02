import { diagnostic } from '../diagnostics.ts';
import { ownList, readMetadata, type AnyConstructor } from '../metadata.ts';

const LISTENERS = Symbol('listeners');

export interface ListenerDefinition {
  Event: AnyConstructor;
  handlerName: string | symbol;
}

export function OnEvent<E extends object>(Event: AnyConstructor<E>) {
  return function <This extends object, M extends (this: This, event: E) => unknown>(
    _method: M,
    context: ClassMethodDecoratorContext<This, M>
  ): void {
    if (context.private || context.static) {
      throw new Error(diagnostic('events.invalidListener', { name: String(context.name) }));
    }
    ownList<ListenerDefinition>(context.metadata, LISTENERS).push({ Event, handlerName: context.name });
  };
}

export function readListeners(target: object) {
  return (readMetadata(target)[LISTENERS] as ListenerDefinition[] | undefined) ?? [];
}
