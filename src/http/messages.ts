import type { Request } from 'express';

export type MessageParams = Record<string, string | number>;

export type MessageResolver = (
  code: string,
  params: MessageParams | undefined,
  req: Request
) => string | undefined;

export const DEFAULT_MESSAGES: Readonly<Record<string, string>> = {
  'errors.badRequest': 'The request is not valid',
  'errors.validation': 'Invalid input data',
  'errors.unauthorized': 'You must sign in to continue',
  'errors.forbidden': 'You are not allowed to perform this action',
  'errors.notFound': 'The requested resource does not exist',
  'errors.routeNotFound': 'The route {path} does not exist',
  'errors.conflict': 'The resource already exists',
  'errors.payloadTooLarge': 'The request exceeds the maximum allowed size',
  'errors.unsupportedMediaType': 'The content type is not allowed',
  'errors.internal': 'An unexpected error occurred',
  'errors.serviceUnavailable': 'The service is not available right now',
};

export function interpolate(template: string, params: MessageParams = {}) {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match
  );
}
