import assert from 'node:assert/strict';
import { argon2Sync, randomBytes } from 'node:crypto';
import { describe, it, mock } from 'node:test';
import { Controller, Delete, Get, Module, Public, createApp, inject, silentLogger } from '../../src/index.ts';
import {
  CRYPTO_OPTIONS,
  CryptoModule,
  Encryptor,
  Signed,
  UrlSigner,
  hashPassword,
  hashToken,
  needsRehash,
  randomToken,
  safeEqual,
  verifyPassword,
  type CryptoOptions,
} from '../../src/crypto/index.ts';
import { createTestingApp } from '../../src/testing/index.ts';

const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);

async function resolve<T>(options: CryptoOptions, token: new () => T) {
  @Module({ imports: [CryptoModule.forRoot(options)] })
  class AppModule {}

  const app = createApp({ rootModule: AppModule, logger: silentLogger });
  await app.init();
  return { service: app.get(token), close: () => app.close() };
}

function phc(password: string, m: number, t: number, p: number) {
  const salt = randomBytes(16);
  const hash = argon2Sync('argon2id', { message: password, nonce: salt, memory: m, passes: t, parallelism: p, tagLength: 32 });
  const encode = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=${m},t=${t},p=${p}$${encode(salt)}$${encode(hash)}`;
}

describe('viga/crypto', () => {
  describe('contraseñas', () => {
    it('genera un hash Argon2id en formato estándar y con sal aleatoria', async () => {
      const [a, b] = await Promise.all([hashPassword('secret'), hashPassword('secret')]);

      assert.match(a, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
      assert.notEqual(a, b);
    });

    it('verifica la contraseña correcta y rechaza las demás', async () => {
      const stored = await hashPassword('correct horse');

      assert.equal(await verifyPassword('correct horse', stored), true);
      assert.equal(await verifyPassword('correct horsf', stored), false);
      assert.equal(await verifyPassword('', stored), false);
    });

    it('acepta la misma contraseña escrita con otra codificación Unicode', async () => {
      const stored = await hashPassword('contraseña');
      assert.equal(await verifyPassword('contraseña', stored), true);
    });

    it('devuelve false con hashes mal formados, sin lanzar errores', async () => {
      const valid = await hashPassword('x');
      const invalid = [
        '',
        'plain',
        '$2b$12$abcdefghijklmnopqrstuv',
        valid.replace('argon2id', 'argon2i'),
        valid.replace('v=19', 'v=16'),
        valid.replace('m=19456', 'm=1'),
        valid.replace('m=19456', 'm=99999999'),
        valid.replace('t=2', 't=0'),
        valid.replace('t=2', 't=999'),
        valid.replace('p=1', 'p=0'),
        valid.replace(/\$[^$]+$/, '$QUJD'),
        `${valid}$extra`,
      ];

      for (const stored of invalid) {
        assert.equal(await verifyPassword('x', stored), false, stored);
      }
    });

    it('verifica un hash generado por la implementación de referencia de Argon2', async () => {
      const reference = '$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc';

      assert.equal(await verifyPassword('password', reference), true);
      assert.equal(await verifyPassword('Password', reference), false);
    });

    it('verifica hashes creados con otros parámetros y needsRehash los detecta', async () => {
      const old = phc('secret', 8192, 3, 1);

      assert.equal(await verifyPassword('secret', old), true);
      assert.equal(needsRehash(old), true);
      assert.equal(needsRehash(await hashPassword('secret')), false);
      assert.equal(needsRehash('$2b$12$abcdefghijklmnopqrstuv'), true);
    });
  });

  describe('tokens', () => {
    it('randomToken genera valores aleatorios en base64url', () => {
      const token = randomToken();

      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      assert.notEqual(token, randomToken());
      assert.equal(Buffer.from(randomToken(16), 'base64url').length, 16);
    });

    it('randomToken rechaza tamaños inseguros', () => {
      assert.throws(() => randomToken(8), /at least 16/);
      assert.throws(() => randomToken(16.5), /at least 16/);
    });

    it('hashToken es determinista y no revela el token', () => {
      assert.equal(hashToken('abc'), hashToken('abc'));
      assert.match(hashToken('abc'), /^[0-9a-f]{64}$/);
      assert.notEqual(hashToken('abc'), hashToken('abd'));
    });

    it('safeEqual compara valores de cualquier longitud', () => {
      assert.equal(safeEqual('abc', 'abc'), true);
      assert.equal(safeEqual('abc', 'abd'), false);
      assert.equal(safeEqual('abc', 'abcd'), false);
      assert.equal(safeEqual('', ''), true);
    });
  });

  describe('UrlSigner', () => {
    const withSigner = async (options: CryptoOptions = { signingKeys: [KEY_A] }) => resolve(options, UrlSigner);
    const tamper = (url: string, from: string | RegExp, to: string) => url.replace(from, to);

    it('firma una ruta y verifica el resultado', async () => {
      const { service, close } = await withSigner();

      const url = service.sign('/files/42', { expiresInSeconds: 60 });

      assert.match(url, /^\/files\/42\?expires=\d+&signature=[\w-]{43}$/);
      assert.equal(service.verify(url), true);
      await close();
    });

    it('conserva los parámetros, y su orden no afecta a la firma', async () => {
      const { service, close } = await withSigner();

      const url = service.sign('/files/42?b=2&a=1', { expiresInSeconds: 60 });
      const reordered = url.replace('b=2&a=1', 'a=1&b=2');

      assert.equal(service.verify(url), true);
      assert.equal(service.verify(reordered), true);
      await close();
    });

    it('rechaza cualquier cambio en la URL', async () => {
      const { service, close } = await withSigner();
      const url = service.sign('/files/42?size=small', { expiresInSeconds: 60 });

      assert.equal(service.verify(tamper(url, '/files/42', '/files/43')), false);
      assert.equal(service.verify(tamper(url, 'small', 'large')), false);
      assert.equal(service.verify(`${url}&admin=1`), false);
      assert.equal(service.verify(tamper(url, /expires=\d+/, 'expires=99999999999')), false);
      assert.equal(service.verify(tamper(url, /signature=[\w-]+/, 'signature=abc')), false);
      assert.equal(service.verify(tamper(url, /&?signature=[\w-]+/, '')), false);
      assert.equal(service.verify(tamper(url, /expires=\d+&?/, '')), false);
      assert.equal(service.verify('/files/42'), false);
      await close();
    });

    it('rechaza rutas que el servidor interpretaría distinto de lo firmado', async () => {
      const { service, close } = await withSigner();
      const url = service.sign('/private', { expiresInSeconds: 60 });

      assert.equal(service.verify(url.replace('/private', '/public/../private')), false);
      assert.equal(service.verify(`/${url}`), false);
      assert.equal(service.verify(url.replace('/private', 'private')), false);
      await close();
    });

    it('rechaza una URL caducada', async (t) => {
      const { service, close } = await withSigner();
      t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });

      const url = service.sign('/files/42', { expiresInSeconds: 60 });
      assert.equal(service.verify(url), true);

      t.mock.timers.tick(60_000);
      assert.equal(service.verify(url), false);
      await close();
    });

    it('la firma incluye el método', async () => {
      const { service, close } = await withSigner();

      const get = service.sign('/files/42', { expiresInSeconds: 60 });
      const del = service.sign('/files/42', { expiresInSeconds: 60, method: 'delete' });

      assert.equal(service.verify(get, { method: 'DELETE' }), false);
      assert.equal(service.verify(del), false);
      assert.equal(service.verify(del, { method: 'DELETE' }), true);
      await close();
    });

    it('firma con la primera clave y verifica con todas', async () => {
      const previous = await withSigner({ signingKeys: [KEY_A] });
      const url = previous.service.sign('/files/42', { expiresInSeconds: 60 });
      await previous.close();

      const rotated = await withSigner({ signingKeys: [KEY_B, KEY_A] });
      assert.equal(rotated.service.verify(url), true);
      await rotated.close();

      const removed = await withSigner({ signingKeys: [KEY_B] });
      assert.equal(removed.service.verify(url), false);
      await removed.close();
    });

    it('rechaza entradas inválidas al firmar', async () => {
      const { service, close } = await withSigner();

      assert.throws(() => service.sign('files/42', { expiresInSeconds: 60 }), /Only paths/);
      assert.throws(() => service.sign('//evil.com/x', { expiresInSeconds: 60 }), /Only paths/);
      assert.throws(() => service.sign('https://evil.com/x', { expiresInSeconds: 60 }), /Only paths/);
      assert.throws(() => service.sign('/x#frag', { expiresInSeconds: 60 }), /Only paths/);
      assert.throws(() => service.sign('/x?expires=1', { expiresInSeconds: 60 }), /expires or signature/);
      assert.throws(() => service.sign('/x', { expiresInSeconds: 0 }), /positive integer/);
      assert.throws(() => service.sign('/x', { expiresInSeconds: 1.5 }), /positive integer/);
      await close();
    });

    it('sin claves, usarlo da un error claro', async () => {
      const { service, close } = await withSigner({});

      assert.throws(() => service.sign('/x', { expiresInSeconds: 60 }), /signingKeys/);
      assert.throws(() => service.verify('/x'), /signingKeys/);
      await close();
    });

    it('no arranca con una clave corta y no la muestra en el error', async () => {
      await assert.rejects(
        withSigner({ signingKeys: ['too-short-secret'] }),
        (error: Error) => /signingKeys\[0\]/.test(error.message) && !error.message.includes('too-short-secret')
      );
    });

    it('@Signed protege la ruta, también con globalPrefix, HEAD y parámetros', async () => {
      @Public()
      @Controller('/files')
      class FilesController {
        private readonly signer = inject(UrlSigner);

        @Get('/link')
        link() {
          return { url: this.signer.sign('/api/files/42?size=small', { expiresInSeconds: 60 }) };
        }

        @Signed()
        @Get('/:id')
        download() {
          return 'content';
        }

        @Signed()
        @Delete('/:id')
        remove() {
          return 'removed';
        }
      }

      @Module({ imports: [CryptoModule.forRoot({ signingKeys: [KEY_A] })], controllers: [FilesController] })
      class AppModule {}

      const app = await createTestingApp(AppModule, { globalPrefix: '/api' });
      const { body } = await app.request<{ url: string }>('/api/files/link');

      assert.equal((await app.request(body.url)).status, 200);
      assert.equal((await app.request(body.url, { method: 'HEAD' })).status, 200);
      assert.equal((await app.request(body.url, { method: 'DELETE' })).status, 403);
      assert.equal((await app.request(body.url.replace('42', '43'))).status, 403);
      assert.equal((await app.request('/api/files/42')).status, 403);
      await app.close();
    });

    it('@Signed sobre la clase protege todas sus rutas', async () => {
      @Public()
      @Signed()
      @Controller('/files')
      class FilesController {
        @Get('/:id')
        download() {
          return 'content';
        }
      }

      @Module({ imports: [CryptoModule.forRoot({ signingKeys: [KEY_A] })], controllers: [FilesController] })
      class AppModule {}

      const app = await createTestingApp(AppModule);
      const url = app.get(UrlSigner).sign('/files/1', { expiresInSeconds: 60 });

      assert.equal((await app.request(url)).status, 200);
      assert.equal((await app.request('/files/1')).status, 403);
      await app.close();
    });
  });

  describe('Encryptor', () => {
    const options: CryptoOptions = { encryption: { active: 'k1', keys: { k1: KEY_A } } };

    it('cifra y descifra, con un resultado distinto cada vez', async () => {
      const { service, close } = await resolve(options, Encryptor);

      const a = service.encrypt('sk_live_ñandú');
      const b = service.encrypt('sk_live_ñandú');

      assert.match(a, /^v1\.k1\.[\w-]{16}\.[\w-]+\.[\w-]{22}$/);
      assert.notEqual(a, b);
      assert.ok(!a.includes('sk_live'));
      assert.equal(service.decrypt(a), 'sk_live_ñandú');
      assert.equal(service.decrypt(service.encrypt('')), '');
      await close();
    });

    it('el contexto ata el valor a su dueño', async () => {
      const { service, close } = await resolve(options, Encryptor);
      const secret = service.encrypt('value', { context: 'tenant:1' });

      assert.equal(service.decrypt(secret, { context: 'tenant:1' }), 'value');
      assert.throws(() => service.decrypt(secret, { context: 'tenant:2' }), /could not be decrypted/);
      assert.throws(() => service.decrypt(secret), /could not be decrypted/);
      await close();
    });

    it('rechaza valores alterados o mal formados con el mismo error', async () => {
      const { service, close } = await resolve(options, Encryptor);
      const parts = service.encrypt('value').split('.');
      const flip = (index: number) =>
        parts.map((part, i) => (i === index ? `${part[0] === 'A' ? 'B' : 'A'}${part.slice(1)}` : part)).join('.');

      for (const value of [flip(2), flip(3), flip(4), '', 'plain', 'v1.k1', 'v2.k1.a.b.c', 'v1.unknown.a.b.c', `${parts.join('.')}.x`]) {
        assert.throws(() => service.decrypt(value), /could not be decrypted/, value);
      }
      await close();
    });

    it('rota claves: cifra con la activa y descifra con cualquiera', async () => {
      const previous = await resolve(options, Encryptor);
      const old = previous.service.encrypt('value');
      await previous.close();

      const { service, close } = await resolve({ encryption: { active: 'k2', keys: { k1: KEY_A, k2: KEY_B } } }, Encryptor);

      assert.equal(service.decrypt(old), 'value');
      assert.match(service.encrypt('value'), /^v1\.k2\./);
      await close();
    });

    it('la misma clave para firmar y cifrar produce claves independientes', async () => {
      const { service, close } = await resolve({ signingKeys: [KEY_A], encryption: { active: 'k', keys: { k: KEY_A } } }, Encryptor);
      assert.equal(service.decrypt(service.encrypt('value')), 'value');
      await close();
    });

    it('no arranca con opciones inválidas', async () => {
      await assert.rejects(resolve({ encryption: { active: 'k', keys: { k: 'short' } } }, Encryptor), /encryption\.keys\.k/);
      await assert.rejects(resolve({ encryption: { active: 'other', keys: { k: KEY_A } } }, Encryptor), /"other"/);
      await assert.rejects(resolve({ encryption: { active: 'a.b', keys: { 'a.b': KEY_A } } }, Encryptor), /"a\.b"/);
    });

    it('sin la opción encryption, usarlo da un error claro', async () => {
      const { service, close } = await resolve({}, Encryptor);

      assert.throws(() => service.encrypt('x'), /encryption option/);
      assert.throws(() => service.decrypt('x'), /encryption option/);
      await close();
    });
  });

  describe('CryptoModule', () => {
    it('acepta una función que se ejecuta una vez al arrancar', async () => {
      const seen = mock.fn();

      @Module({
        imports: [
          CryptoModule.forRoot(() => {
            seen();
            return { signingKeys: [KEY_A] };
          }),
        ],
      })
      class AppModule {}

      const app = await createTestingApp(AppModule);
      assert.equal(seen.mock.callCount(), 1);
      assert.deepEqual(app.get(CRYPTO_OPTIONS), { signingKeys: [KEY_A] });
      await app.close();
    });
  });
});
