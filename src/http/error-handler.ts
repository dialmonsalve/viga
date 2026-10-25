import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import { STATUS_CODES } from 'node:http';
import type { Logger } from '../logger.ts';
import type { GuardFn } from '../decorators/use-guards.ts';
import { createContext } from './context.ts';
import { HttpException, NotFoundException } from './exceptions.ts';
import { authenticate } from './router.ts';
import { DEFAULT_MESSAGES, interpolate, type MessageResolver } from './messages.ts';
import { diagnostic } from '../diagnostics.ts';
import { REQUEST_ID } from './request-id.ts';

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  error: string;
  details?: unknown;
  requestId?: string;
  timestamp: string;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'errors.badRequest',
  401: 'errors.unauthorized',
  403: 'errors.forbidden',
  404: 'errors.notFound',
  409: 'errors.conflict',
  413: 'errors.payloadTooLarge',
  415: 'errors.unsupportedMediaType',
  429: 'errors.tooManyRequests',
  503: 'errors.serviceUnavailable',
};

interface ExposedHttpError {
  status: number;
  expose: true;
}

function isExposedClientError(error: unknown): error is ExposedHttpError {
  if (typeof error !== 'object' || error === null) return false;
  const { status, expose } = error as Partial<ExposedHttpError>;
  return expose === true && typeof status === 'number' && status >= 400 && status < 500;
}

export function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (isExposedClientError(error)) {
    const { status } = error;
    return new HttpException(
      status,
      CODE_BY_STATUS[status] ?? 'errors.badRequest',
      STATUS_CODES[status] ?? 'Error'
    );
  }
  return new HttpException(500, 'errors.internal', 'Internal Server Error');
}

export function describeException(
  exception: HttpException,
  req: Request,
  resolveMessage?: MessageResolver
) {
  const { code, params, statusCode } = exception;

  const resolved = resolveMessage?.(code, params, req);
  if (resolved !== undefined) return { code, message: resolved };

  const fallback = DEFAULT_MESSAGES[code];
  if (fallback !== undefined) return { code, message: interpolate(fallback, params) };

  return { code: CODE_BY_STATUS[statusCode] ?? 'errors.internal', message: code };
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundException('errors.routeNotFound'));
};

export function concealedNotFoundHandler(authGuard: GuardFn | undefined): RequestHandler {
  return (req, res, next) => {
    authenticate(authGuard, createContext(req, res)).then(
      () => next(new NotFoundException('errors.routeNotFound')),
      next
    );
  };
}

export function createErrorHandler(
  logger: Logger,
  resolveMessage?: MessageResolver
): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const exception = toHttpException(err);
    const { statusCode, error, details } = exception;
    const requestId = REQUEST_ID.find();

    if (statusCode >= 500) {
      if (requestId === undefined) {
        logger.error(diagnostic('http.unhandledException'), err);
      } else {
        logger.error(diagnostic('http.unhandledException'), err, { requestId });
      }
    }

    const body: ApiErrorBody = {
      statusCode,
      ...describeException(exception, req, resolveMessage),
      error,
      ...(details === undefined ? {} : { details }),
      ...(requestId === undefined ? {} : { requestId }),
      timestamp: new Date().toISOString(),
    };

    res.status(statusCode).json(body);
  };
}
