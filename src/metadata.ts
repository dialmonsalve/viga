export type AnyConstructor<T = unknown> = new (...args: any[]) => T;

export const MODULE = Symbol('module');
export const INJECTABLE = Symbol('injectable');
export const CONTROLLER = Symbol('controller');
export const ROUTES = Symbol('routes');
export const HTTP_CODES = Symbol('httpCodes');
export const PUBLIC = Symbol('public');
export const PUBLIC_ROUTES = Symbol('publicRoutes');
export const INTERCEPTORS = Symbol('interceptors');

export function readMetadata(target: object): DecoratorMetadataObject {
  const holder = target as { [Symbol.metadata]?: DecoratorMetadataObject | null };
  return holder[Symbol.metadata] ?? {};
}

export function readOwn<T>(target: object, key: symbol): T | undefined {
  const metadata = readMetadata(target);
  return Object.hasOwn(metadata, key) ? (metadata[key] as T) : undefined;
}

export function ownList<T>(metadata: DecoratorMetadataObject, key: symbol): T[] {
  if (!Object.hasOwn(metadata, key)) {
    metadata[key] = [...((metadata[key] as T[] | undefined) ?? [])];
  }
  return metadata[key] as T[];
}

export function ownRecord<T>(
  metadata: DecoratorMetadataObject,
  key: symbol
): Record<PropertyKey, T> {
  if (!Object.hasOwn(metadata, key)) {
    metadata[key] = { ...((metadata[key] as Record<PropertyKey, T> | undefined) ?? {}) };
  }
  return metadata[key] as Record<PropertyKey, T>;
}
