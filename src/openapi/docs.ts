import { ownRecord, readMetadata, readOwn, type AnyConstructor } from '../metadata.ts';
import type { StandardSchemaV1 } from '../standard-schema.ts';

export type DocsResponse = StandardSchemaV1 | string;

export interface DocsOptions {
  summary?: string;
  description?: string;
  tags?: readonly string[];
  responses?: Readonly<Record<number, DocsResponse>>;
  deprecated?: boolean;
  hidden?: boolean;
}

const METHOD_DOCS = Symbol('methodDocs');
const CLASS_DOCS = Symbol('classDocs');

export function Docs(options: DocsOptions) {
  return function (_target: unknown, context: ClassDecoratorContext | ClassMethodDecoratorContext) {
    if (context.kind === 'class') {
      context.metadata[CLASS_DOCS] = options;
    } else {
      ownRecord<DocsOptions>(context.metadata, METHOD_DOCS)[context.name] = options;
    }
  };
}

export function readDocs(controller: AnyConstructor, handlerName: PropertyKey): DocsOptions {
  const fromClass = readOwn<DocsOptions>(controller, CLASS_DOCS);
  const methods = readMetadata(controller)[METHOD_DOCS] as Record<PropertyKey, DocsOptions> | undefined;

  return {
    ...(fromClass?.tags ? { tags: fromClass.tags } : {}),
    ...(fromClass?.deprecated ? { deprecated: true } : {}),
    ...(fromClass?.hidden ? { hidden: true } : {}),
    ...methods?.[handlerName],
  };
}
