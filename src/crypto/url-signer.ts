import { createHmac } from 'node:crypto';
import { Injectable } from '../decorators/injectable.ts';
import { inject } from '../di/injector.ts';
import { diagnostic } from '../diagnostics.ts';
import { CRYPTO_OPTIONS, deriveKey } from './options.ts';
import { safeEqual } from './tokens.ts';

export interface SignUrlOptions {
  expiresInSeconds: number;
  method?: string;
}

export interface VerifyUrlOptions {
  method?: string;
}

const EXPIRES = 'expires';
const SIGNATURE = 'signature';

function parsePath(path: string) {
  if (!path.startsWith('/') || path.startsWith('//')) return undefined;
  return new URL(`http://viga.invalid${path}`);
}

@Injectable()
export class UrlSigner {
  private readonly keys = (inject(CRYPTO_OPTIONS).signingKeys ?? []).map((key, index) =>
    deriveKey(key, 'url-signing', `signingKeys[${index}]`)
  );

  sign(path: string, { expiresInSeconds, method = 'GET' }: SignUrlOptions): string {
    const [key] = this.keys;
    if (!key) throw new Error(diagnostic('crypto.noSigningKeys'));
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new Error(diagnostic('crypto.invalidExpiry', { expiresInSeconds }));
    }

    const url = parsePath(path);
    if (!url || url.hash) throw new Error(diagnostic('crypto.invalidSignedPath', { path }));
    if (url.searchParams.has(EXPIRES) || url.searchParams.has(SIGNATURE)) {
      throw new Error(diagnostic('crypto.reservedSignedParam', { path }));
    }

    url.searchParams.set(EXPIRES, String(Math.floor(Date.now() / 1000) + expiresInSeconds));
    url.searchParams.set(SIGNATURE, this.signature(key, method, url));
    return `${url.pathname}${url.search}`;
  }

  verify(path: string, { method = 'GET' }: VerifyUrlOptions = {}): boolean {
    if (this.keys.length === 0) throw new Error(diagnostic('crypto.noSigningKeys'));

    const url = parsePath(path);
    if (!url || url.pathname !== path.split(/[?#]/, 1)[0]) return false;

    const signature = url.searchParams.get(SIGNATURE);
    const expires = url.searchParams.get(EXPIRES);
    if (!signature || !expires || !/^\d{1,15}$/.test(expires)) return false;
    if (Number(expires) * 1000 <= Date.now()) return false;

    return this.keys
      .map((key) => safeEqual(this.signature(key, method, url), signature))
      .some(Boolean);
  }

  private signature(key: Buffer, method: string, url: URL) {
    const params = new URLSearchParams(url.searchParams);
    params.delete(SIGNATURE);
    params.sort();
    return createHmac('sha256', key)
      .update(`${method.toUpperCase()}\n${url.pathname}\n${params}`)
      .digest('base64url');
  }
}
