import { HttpException } from '../http/exceptions.ts';

export function tooManyMessages(retryAfter: number) {
  return new HttpException(429, 'errors.tooManyRequests', 'Too Many Requests', { retryAfter });
}
