import { hkdfSync } from 'node:crypto';
import { InjectionToken } from '../di/injector.ts';
import { diagnostic } from '../diagnostics.ts';

export interface EncryptionOptions {
  active: string;
  keys: Record<string, string>;
}

export interface CryptoOptions {
  signingKeys?: readonly string[];
  encryption?: EncryptionOptions;
}

export const CRYPTO_OPTIONS = new InjectionToken<CryptoOptions>('CRYPTO_OPTIONS');

const MIN_KEY_BYTES = 32;

export function deriveKey(secret: string, purpose: string, name: string) {
  if (Buffer.byteLength(secret) < MIN_KEY_BYTES) {
    throw new Error(diagnostic('crypto.shortKey', { name, min: MIN_KEY_BYTES }));
  }
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), `viga/crypto ${purpose}`, MIN_KEY_BYTES));
}
