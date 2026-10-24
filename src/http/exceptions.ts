import type { MessageParams } from './messages.ts';

export class HttpException extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    public readonly error: string = 'Error',
    public readonly details?: unknown,
    public readonly params?: MessageParams
  ) {
    super(code);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestException extends HttpException {
  constructor(code = 'errors.badRequest', details?: unknown, params?: MessageParams) {
    super(400, code, 'Bad Request', details, params);
  }
}

export class UnauthorizedException extends HttpException {
  constructor(code = 'errors.unauthorized', params?: MessageParams) {
    super(401, code, 'Unauthorized', undefined, params);
  }
}

export class ForbiddenException extends HttpException {
  constructor(code = 'errors.forbidden', params?: MessageParams) {
    super(403, code, 'Forbidden', undefined, params);
  }
}

export class NotFoundException extends HttpException {
  constructor(code = 'errors.notFound', params?: MessageParams) {
    super(404, code, 'Not Found', undefined, params);
  }
}

export class ConflictException extends HttpException {
  constructor(code = 'errors.conflict', params?: MessageParams) {
    super(409, code, 'Conflict', undefined, params);
  }
}

export class PayloadTooLargeException extends HttpException {
  constructor(code = 'errors.payloadTooLarge', params?: MessageParams) {
    super(413, code, 'Payload Too Large', undefined, params);
  }
}

export class UnsupportedMediaTypeException extends HttpException {
  constructor(code = 'errors.unsupportedMediaType', params?: MessageParams) {
    super(415, code, 'Unsupported Media Type', undefined, params);
  }
}

export class TooManyRequestsException extends HttpException {
  constructor(code = 'errors.tooManyRequests', params?: MessageParams) {
    super(429, code, 'Too Many Requests', undefined, params);
  }
}

export class InternalServerErrorException extends HttpException {
  constructor(code = 'errors.internal', params?: MessageParams) {
    super(500, code, 'Internal Server Error', undefined, params);
  }
}

export class ServiceUnavailableException extends HttpException {
  constructor(code = 'errors.serviceUnavailable', params?: MessageParams) {
    super(503, code, 'Service Unavailable', undefined, params);
  }
}
