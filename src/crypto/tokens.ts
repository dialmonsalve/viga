import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { diagnostic } from '../diagnostics.ts';

const MIN_TOKEN_BYTES = 16;

function sha256(value: string) {
  return createHash('sha256').update(value).digest();
}

export function randomToken(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < MIN_TOKEN_BYTES) {
    throw new Error(diagnostic('crypto.invalidTokenSize', { min: MIN_TOKEN_BYTES, bytes }));
  }
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return sha256(token).toString('hex');
}

export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}
