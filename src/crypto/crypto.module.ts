import { Module } from '../decorators/module.ts';
import { Encryptor } from './encryptor.ts';
import { CRYPTO_OPTIONS, type CryptoOptions } from './options.ts';
import { UrlSigner } from './url-signer.ts';

export class CryptoModule {
  static forRoot(options: CryptoOptions | (() => CryptoOptions)) {
    const provider =
      typeof options === 'function'
        ? { provide: CRYPTO_OPTIONS, useFactory: options }
        : { provide: CRYPTO_OPTIONS, useValue: options };

    @Module({
      global: true,
      providers: [provider, UrlSigner, Encryptor],
      exports: [CRYPTO_OPTIONS, UrlSigner, Encryptor],
    })
    class CryptoRootModule {}

    return CryptoRootModule;
  }
}
