import { PUBLIC, PUBLIC_ROUTES, ownRecord } from '../metadata.ts';

export function Public() {
  return function (
    _target: unknown,
    context: ClassDecoratorContext | ClassMethodDecoratorContext
  ) {
    if (context.kind === 'class') {
      context.metadata[PUBLIC] = true;
    } else {
      ownRecord<boolean>(context.metadata, PUBLIC_ROUTES)[context.name] = true;
    }
  };
}
