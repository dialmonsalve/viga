import { INJECTABLE, type AnyConstructor } from '../metadata.ts';

export function Injectable() {
  return function (_target: AnyConstructor, context: ClassDecoratorContext) {
    context.metadata[INJECTABLE] = true;
  };
}
