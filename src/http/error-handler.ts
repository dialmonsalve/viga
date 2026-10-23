import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import { STATUS_CODES } from 'node:http';
import type { Logger } from '../logger.ts';
import { HttpException, NotFoundException } from './exceptions.ts';
import { DEFAULT_MESSAGES, interpolate, type MessageResolver } from './messages.ts';
import { diagnostic } from '../diagnostics.ts';

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  error: string;
  details?: unknown;
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

function toHttpException(error: unknown): HttpException {
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

function describe(exception: HttpException, req: Request, resolveMessage?: MessageResolver) {
  const { code, params, statusCode } = exception;

  const resolved = resolveMessage?.(code, params, req);
  if (resolved !== undefined) return { code, message: resolved };

  const fallback = DEFAULT_MESSAGES[code];
  if (fallback !== undefined) return { code, message: interpolate(fallback, params) };

  return { code: CODE_BY_STATUS[statusCode] ?? 'errors.internal', message: code };
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundException('errors.routeNotFound', { path: req.path }));
};

export function createErrorHandler(
  logger: Logger,
  resolveMessage?: MessageResolver
): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const exception = toHttpException(err);
    const { statusCode, error, details } = exception;

    if (statusCode >= 500) {
      logger.error(diagnostic('http.unhandledException'), err);
    }

    const body: ApiErrorBody = {
      statusCode,
      ...describe(exception, req, resolveMessage),
      error,
      ...(details === undefined ? {} : { details }),
      timestamp: new Date().toISOString(),
    };

    res.status(statusCode).json(body);
  };
}
