import { PUBLIC, PUBLIC_ROUTES } from '../metadata.ts';

export function Public() {
  return function (
    _target: unknown,
    context: ClassDecoratorContext | ClassMethodDecoratorContext
  ) {
    if (context.kind === 'class') {
      context.metadata[PUBLIC] = true;
    } else {
      if (!Object.hasOwn(context.metadata, PUBLIC_ROUTES)) context.metadata[PUBLIC_ROUTES] = {};
      (context.metadata[PUBLIC_ROUTES] as Record<PropertyKey, boolean>)[context.name] = true;
    }
  };
}
