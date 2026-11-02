import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '../decorators/injectable.ts';
import { inject } from '../di/injector.ts';
import { diagnostic } from '../diagnostics.ts';
import { CRYPTO_OPTIONS, deriveKey } from './options.ts';

export interface EncryptOptions {
  context?: string;
}

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID = /^[A-Za-z0-9_-]+$/;

function additionalData(keyId: string, context = '') {
  return Buffer.from(`${VERSION}.${keyId}\n${context}`);
}

@Injectable()
export class Encryptor {
  private readonly options = inject(CRYPTO_OPTIONS).encryption;
  private readonly keys = new Map(
    Object.entries(this.options?.keys ?? {}).map(([id, key]) => {
      if (!KEY_ID.test(id)) throw new Error(diagnostic('crypto.invalidKeyId', { id }));
      return [id, deriveKey(key, 'encryption', `encryption.keys.${id}`)];
    })
  );

  constructor() {
    if (this.options && !this.keys.has(this.options.active)) {
      throw new Error(diagnostic('crypto.unknownActiveKey', { active: this.options.active }));
    }
  }

  encrypt(plaintext: string, { context }: EncryptOptions = {}): string {
    if (!this.options) throw new Error(diagnostic('crypto.noEncryptionKeys'));

    const keyId = this.options.active;
    const key = this.keys.get(keyId);
    if (!key) throw new Error(diagnostic('crypto.noEncryptionKeys'));

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(additionalData(keyId, context));
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return [
      VERSION,
      keyId,
      iv.toString('base64url'),
      data.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join('.');
  }

  decrypt(encrypted: string, { context }: EncryptOptions = {}): string {
    if (!this.options) throw new Error(diagnostic('crypto.noEncryptionKeys'));

    const [version, keyId, iv, data, tag, ...rest] = encrypted.split('.');
    const key = keyId === undefined ? undefined : this.keys.get(keyId);
    if (
      version !== VERSION ||
      rest.length > 0 ||
      keyId === undefined ||
      !key ||
      iv === undefined ||
      data === undefined ||
      tag === undefined
    ) {
      throw new Error(diagnostic('crypto.decryptFailed'));
    }

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(additionalData(keyId, context));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new Error(diagnostic('crypto.decryptFailed'));
    }
  }
}
