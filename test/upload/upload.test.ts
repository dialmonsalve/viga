import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import {
  Controller,
  HttpCode,
  Module,
  Post,
  Public,
  RateLimit,
  UseGuards,
  silentLogger,
} from '../../src/index.ts';
import { createTestingApp, type TestingApp } from '../../src/testing/index.ts';
import {
  Upload,
  type OptionalUploadContext,
  type UploadContext,
  type UploadedFile,
  type UploadOptions,
} from '../../src/upload/index.ts';
import { Validate } from '../../src/validation/index.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

const uploadDirs = () => readdirSync(tmpdir()).filter((name) => /^viga-upload-(?!test-)/.test(name));

async function settledUploadDirs() {
  await sleep(150);
  return uploadDirs().length;
}

function form(parts: Record<string, string | { name: string; type?: string; content: Buffer } | { name: string; content: Buffer }[]>) {
  const data = new FormData();
  for (const [field, value] of Object.entries(parts)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string') data.append(field, item);
      else data.append(field, new Blob([new Uint8Array(item.content)], { type: 'type' in item ? item.type : undefined }), item.name);
    }
  }
  return data;
}

async function send(app: TestingApp, path: string, data: FormData, headers: Record<string, string> = {}) {
  const response = await fetch(app.url(path), { method: 'POST', body: data, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

let seen: UploadedFile[] = [];

function appWith(options: UploadOptions) {
  @Public()
  @Controller('/files')
  class FilesController {
    @Post()
    @HttpCode(200)
    @Upload(options)
    upload({ files }: UploadContext) {
      seen = files;
      return files.map(({ originalName, size, type, extension }) => ({ originalName, size, type, extension }));
    }
  }

  @Module({ controllers: [FilesController] })
  class AppModule {}

  return createTestingApp(AppModule);
}

describe('viga/upload', () => {
  const destination = mkdtempSync(join(tmpdir(), 'viga-upload-test-dest-'));

  after(() => rmSync(destination, { recursive: true, force: true }));

  it('acepta un archivo, detecta su tipo por el contenido y lo borra al terminar', async () => {
    const app = await appWith({ field: 'photo', types: ['image/png'] });

    const { status, body } = await send(app, '/files', form({ photo: { name: 'cat.jpg', type: 'image/jpeg', content: PNG } }));

    assert.equal(status, 200);
    assert.deepEqual(body, [{ originalName: 'cat.jpg', size: PNG.length, type: 'image/png', extension: 'png' }]);
    await sleep(50);
    assert.equal(existsSync(seen[0]!.path), false);
    await app.close();
  });

  it('rechaza con 415 un archivo cuyo contenido no coincide, aunque diga ser PNG', async () => {
    const app = await appWith({ field: 'photo', types: ['image/png'] });

    for (const [name, type, content] of [
      ['evil.png', 'image/png', HTML],
      ['photo.png', 'image/png', JPEG],
      ['empty.png', 'image/png', Buffer.alloc(0)],
    ] as const) {
      const { status, body } = await send(app, '/files', form({ photo: { name, type, content } }));
      assert.equal(status, 415, name);
      assert.equal(body.code, 'errors.unsupportedFileType');
    }
    await app.close();
  });

  it('el nombre guardado no depende del nombre original', async () => {
    const app = await appWith({ field: 'photo', types: ['image/png'] });

    const { body } = await send(app, '/files', form({ photo: { name: '../../../etc/passwd', content: PNG } }));

    assert.equal(body[0].originalName, 'passwd');
    assert.ok(!seen[0]!.path.includes('passwd'));
    assert.match(seen[0]!.path, /viga-upload-[^/]+\/[0-9a-f-]{36}$/);
    await app.close();
  });

  it('limpia los nombres originales y conserva los acentos', async () => {
    const app = await appWith({ field: 'photo', types: ['image/png'] });

    assert.equal((await send(app, '/files', form({ photo: { name: 'niño ñandú.png', content: PNG } }))).body[0].originalName, 'niño ñandú.png');
    assert.equal((await send(app, '/files', form({ photo: { name: 'C:\\temp\\a.png', content: PNG } }))).body[0].originalName, 'a.png');

    const control = await send(app, '/files', form({ photo: { name: 'a\u0001b.png', content: PNG } }));
    assert.ok(control.status === 400 || control.body[0].originalName === 'ab.png');
    await app.close();
  });

  it('responde 413 si supera maxFileSize', async () => {
    const app = await appWith({ field: 'photo', types: ['image/png'], maxFileSize: 10 });

    const { status, body } = await send(app, '/files', form({ photo: { name: 'a.png', content: PNG } }));

    assert.equal(status, 413);
    assert.equal(body.code, 'errors.fileTooLarge');
    await app.close();
  });

  it('el límite por defecto es de 5 MiB', async () => {
    const app = await appWith({ field: 'photo', types: ['image/png'] });
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);

    assert.equal((await send(app, '/files', form({ photo: { name: 'a.png', content: big } }))).status, 413);
    await app.close();
  });

  it('acepta un solo archivo por defecto y varios con maxFiles', async () => {
    const one = await appWith({ field: 'photo', types: ['image/png'] });
    const two = [{ name: 'a.png', content: PNG }, { name: 'b.png', content: PNG }];
    assert.equal((await send(one, '/files', form({ photo: two }))).status, 400);
    await one.close();

    const many = await appWith({ field: 'photo', types: ['image/png'], maxFiles: 2 });
    const { status, body } = await send(many, '/files', form({ photo: two }));
    assert.equal(status, 200);
    assert.equal(body.length, 2);
    assert.equal((await send(many, '/files', form({ photo: [...two, { name: 'c.png', content: PNG }] }))).status, 400);
    await many.close();
  });

  it('si un archivo de varios no es válido, rechaza la subida', async () => {
    const app = await appWith({ field: 'photo', types: ['image/png'], maxFiles: 2 });

    const { status } = await send(app, '/files', form({ photo: [{ name: 'a.png', content: PNG }, { name: 'b.png', content: HTML }] }));

    assert.equal(status, 415);
    await app.close();
  });

  it('responde 400 sin archivo, con otro campo o sin multipart', async () => {
    const app = await appWith({ field: 'photo', types: ['image/png'] });

    const other = await send(app, '/files', form({ other: { name: 'a.png', content: PNG } }));
    assert.equal(other.status, 400);
    assert.equal(other.body.code, 'errors.invalidUpload');

    const json = await app.request<{ code: string }>('/files', { method: 'POST', json: { a: 1 } });
    assert.equal(json.status, 400);
    assert.equal(json.body.code, 'errors.fileRequired');

    const empty = await app.request<{ code: string }>('/files', { method: 'POST' });
    assert.equal(empty.status, 400);
    await app.close();
  });

  it('responde 400 con un multipart mal formado', async () => {
    const app = await appWith({ field: 'photo', types: ['image/png'] });

    const { status } = await app.request('/files', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      body: '--x\r\nbroken',
    });

    assert.equal(status, 400);
    await app.close();
  });

  describe('campos de texto', () => {
    it('sin @Validate rechaza cualquier campo', async () => {
      const app = await appWith({ field: 'photo', types: ['image/png'] });

      const { status } = await send(app, '/files', form({ title: 'hola', photo: { name: 'a.png', content: PNG } }));

      assert.equal(status, 400);
      await app.close();
    });

    const Form = z.strictObject({ title: z.string().min(1) });

    for (const order of ['@Upload encima', '@Validate encima'] as const) {
      it(`con @Validate los valida, sea cual sea el orden (${order})`, async () => {
        const seenTitles: string[] = [];

        @Public()
        @Controller('/a')
        class Above {
          @Post()
          @HttpCode(200)
          @Upload({ field: 'photo', types: ['image/png'] })
          @Validate({ body: Form })
          upload({ body, file }: UploadContext<{ body: typeof Form }>) {
            seenTitles.push(body.title);
            return { size: file.size };
          }
        }

        @Public()
        @Controller('/b')
        class Below {
          @Post()
          @HttpCode(200)
          @Validate({ body: Form })
          @Upload({ field: 'photo', types: ['image/png'] })
          upload({ body, file }: UploadContext<{ body: typeof Form }>) {
            seenTitles.push(body.title);
            return { size: file.size };
          }
        }

        @Module({ controllers: [Above, Below] })
        class AppModule {}

        const app = await createTestingApp(AppModule);
        const path = order === '@Upload encima' ? '/a' : '/b';

        assert.equal((await send(app, path, form({ title: 'hola', photo: { name: 'a.png', content: PNG } }))).status, 200);
        assert.deepEqual(seenTitles, ['hola']);
        assert.equal((await send(app, path, form({ title: '', photo: { name: 'a.png', content: PNG } }))).status, 400);
        assert.equal((await send(app, path, form({ title: 'a', extra: 'b', photo: { name: 'a.png', content: PNG } }))).status, 400);
        await app.close();
      });
    }

    it('los límites de campos se aplican, y __proto__ no contamina nada', async () => {
      const Loose = z.object({ title: z.string() });

      @Public()
      @Controller('/f')
      class FieldsController {
        @Post()
        @HttpCode(200)
        @Upload({ field: 'photo', types: ['image/png'], maxFields: 2, maxFieldSize: 5 })
        @Validate({ body: Loose })
        upload({ body }: UploadContext<{ body: typeof Loose }>) {
          return { title: body.title, polluted: 'polluted' in {} };
        }
      }

      @Module({ controllers: [FieldsController] })
      class AppModule {}

      const app = await createTestingApp(AppModule);
      const photo = { name: 'a.png', content: PNG };

      assert.equal((await send(app, '/f', form({ title: 'toolongvalue', photo }))).status, 400);
      assert.equal((await send(app, '/f', form({ title: 'a', b: 'b', c: 'c', photo }))).status, 400);

      const proto = await send(app, '/f', form({ title: 'a', '__proto__[polluted]': '1', photo }));
      assert.equal(proto.status, 200);
      assert.equal(proto.body.polluted, false);
      await app.close();
    });
  });

  describe('optional', () => {
    const Profile = z.strictObject({ name: z.string().min(1) });
    const seenFiles: (UploadedFile | undefined)[] = [];

    @Public()
    @Controller('/profile')
    class ProfileController {
      @Post()
      @HttpCode(200)
      @Upload({ field: 'avatar', types: ['image/png'], optional: true })
      @Validate({ body: Profile })
      update({ body, file, files }: OptionalUploadContext<{ body: typeof Profile }>) {
        seenFiles.push(file);
        return { name: body.name, hasFile: file !== undefined, count: files.length };
      }

      @Post('/no-fields')
      @HttpCode(200)
      @Upload({ field: 'avatar', types: ['image/png'], optional: true })
      noFields({ file }: OptionalUploadContext) {
        return { hasFile: file !== undefined };
      }

      @Post('/typed')
      @HttpCode(200)
      // @ts-expect-error UploadContext promises a file that an optional upload may not have
      @Upload({ field: 'avatar', types: ['image/png'], optional: true })
      typed({ file }: UploadContext) {
        return { size: file.size };
      }
    }

    @Module({ controllers: [ProfileController] })
    class AppModule {}

    it('acepta el formulario con o sin archivo', async () => {
      const app = await createTestingApp(AppModule);

      const withFile = await send(app, '/profile', form({ name: 'Ana', avatar: { name: 'a.png', content: PNG } }));
      assert.equal(withFile.status, 200);
      assert.deepEqual(withFile.body, { name: 'Ana', hasFile: true, count: 1 });

      const without = await send(app, '/profile', form({ name: 'Ana' }));
      assert.equal(without.status, 200);
      assert.deepEqual(without.body, { name: 'Ana', hasFile: false, count: 0 });
      await app.close();
    });

    it('si llega un archivo, se comprueba igual', async () => {
      const app = await createTestingApp(AppModule);

      const { status } = await send(app, '/profile', form({ name: 'Ana', avatar: { name: 'a.png', content: HTML } }));

      assert.equal(status, 415);
      await app.close();
    });

    it('los campos se siguen validando, también sin archivo', async () => {
      const app = await createTestingApp(AppModule);

      assert.equal((await send(app, '/profile', form({ name: '' }))).status, 400);
      assert.equal((await send(app, '/profile', form({ name: 'Ana', extra: 'x' }))).status, 400);
      assert.equal((await app.request('/profile', { method: 'POST' })).status, 400);
      await app.close();
    });

    it('sin @Validate no acepta campos ni otro cuerpo, pero sí una petición vacía', async () => {
      const app = await createTestingApp(AppModule);

      assert.equal((await send(app, '/profile/no-fields', form({ name: 'Ana' }))).status, 400);
      assert.equal((await app.request('/profile/no-fields', { method: 'POST', json: { name: 'Ana' } })).status, 400);

      const empty = await app.request<{ hasFile: boolean }>('/profile/no-fields', { method: 'POST' });
      assert.equal(empty.status, 200);
      assert.equal(empty.body.hasFile, false);

      const file = await send(app, '/profile/no-fields', form({ avatar: { name: 'a.png', content: PNG } }));
      assert.deepEqual(file.body, { hasFile: true });
      await app.close();
    });
  });

  describe('check', () => {
    it('decide sobre formatos de texto, y un false responde 415', async () => {
      const isCsv = (file: UploadedFile) => readFileSync(file.path, 'utf8').startsWith('id,');
      const app = await appWith({ field: 'data', check: isCsv });

      const ok = await send(app, '/files', form({ data: { name: 'a.csv', content: Buffer.from('id,name\n1,a') } }));
      assert.equal(ok.status, 200);
      assert.equal(ok.body[0].type, undefined);

      assert.equal((await send(app, '/files', form({ data: { name: 'a.csv', content: HTML } }))).status, 415);
      await app.close();
    });

    it('con types y check tienen que pasar los dos', async () => {
      const app = await appWith({ field: 'photo', types: ['image/png'], check: (file) => file.size > 1_000_000 });

      assert.equal((await send(app, '/files', form({ photo: { name: 'a.png', content: PNG } }))).status, 415);
      await app.close();
    });

    it('un error dentro de check responde 500', async () => {
      const app = await appWith({
        field: 'photo',
        types: ['image/png'],
        check: () => {
          throw new Error('boom');
        },
      });

      assert.equal((await send(app, '/files', form({ photo: { name: 'a.png', content: PNG } }))).status, 500);
      await app.close();
    });
  });

  describe('moveTo', () => {
    it('mueve el archivo, y no se borra al terminar', async () => {
      const target = join(destination, 'kept.png');

      @Public()
      @Controller('/m')
      class MoveController {
        @Post()
        @HttpCode(200)
        @Upload({ field: 'photo', types: ['image/png'] })
        async upload({ file }: UploadContext) {
          await file.moveTo(target);
          return { path: file.path };
        }
      }

      @Module({ controllers: [MoveController] })
      class AppModule {}

      const app = await createTestingApp(AppModule);
      const { status, body } = await send(app, '/m', form({ photo: { name: 'a.png', content: PNG } }));

      assert.equal(status, 200);
      assert.equal(body.path, target);
      await sleep(50);
      assert.deepEqual(readFileSync(target), PNG);
      await app.close();
    });

    it('no sobrescribe un archivo existente', async () => {
      const target = join(destination, 'existing.png');
      writeFileSync(target, 'keep me');

      @Public()
      @Controller('/m')
      class MoveController {
        @Post()
        @Upload({ field: 'photo', types: ['image/png'] })
        async upload({ file }: UploadContext) {
          await file.moveTo(target);
        }
      }

      @Module({ controllers: [MoveController] })
      class AppModule {}

      const app = await createTestingApp(AppModule, { logger: silentLogger });

      assert.equal((await send(app, '/m', form({ photo: { name: 'a.png', content: PNG } }))).status, 500);
      assert.equal(readFileSync(target, 'utf8'), 'keep me');
      await app.close();
    });
  });

  describe('orden', () => {
    it('no escribe en disco si falla la autenticación o un guard', async () => {
      let handled = 0;

      @Controller('/p')
      class PrivateController {
        @Post()
        @Upload({ field: 'photo', types: ['image/png'] })
        @UseGuards(() => false)
        guarded() {
          handled++;
        }
      }

      @Module({ controllers: [PrivateController] })
      class AppModule {}

      const before = await settledUploadDirs();
      let authenticated = false;
      const app = await createTestingApp(AppModule, { configure: (a) => a.useAuthGuard(() => authenticated) });
      const photo = { photo: { name: 'a.png', content: PNG } };

      assert.equal((await send(app, '/p', form(photo))).status, 401);
      authenticated = true;
      assert.equal((await send(app, '/p', form(photo))).status, 403);

      assert.equal(handled, 0);
      assert.equal(uploadDirs().length, before);
      await app.close();
    });

    it('@RateLimit se aplica antes de leer el archivo', async () => {
      @Public()
      @Controller('/r')
      class LimitedController {
        @Post()
        @HttpCode(200)
        @Upload({ field: 'photo', types: ['image/png'] })
        @RateLimit({ max: 1, windowMs: 60_000 })
        upload() {}
      }

      @Module({ controllers: [LimitedController] })
      class AppModule {}

      const app = await createTestingApp(AppModule);
      const photo = { photo: { name: 'a.png', content: PNG } };

      assert.equal((await send(app, '/r', form(photo))).status, 200);
      assert.equal((await send(app, '/r', form(photo))).status, 429);
      await app.close();
    });

    it('csrf rechaza una subida desde otro sitio antes de leerla', async () => {
      const app = await appWith({ field: 'photo', types: ['image/png'] });

      const { status } = await send(app, '/files', form({ photo: { name: 'a.png', content: PNG } }), { 'sec-fetch-site': 'cross-site' });

      assert.equal(status, 403);
      await app.close();
    });
  });

  describe('limpieza', () => {
    it('borra la carpeta temporal en éxitos, rechazos y errores', async () => {
      const before = await settledUploadDirs();
      const app = await appWith({ field: 'photo', types: ['image/png'], maxFileSize: 1_000 });

      await send(app, '/files', form({ photo: { name: 'a.png', content: PNG } }));
      await send(app, '/files', form({ photo: { name: 'a.png', content: HTML } }));
      await send(app, '/files', form({ photo: { name: 'a.png', content: Buffer.alloc(2_000) } }));
      await sleep(100);

      assert.equal(uploadDirs().length, before);
      await app.close();
    });

    it('borra la carpeta si el cliente corta la conexión a mitad de subida', async () => {
      const before = await settledUploadDirs();
      const app = await appWith({ field: 'photo', types: ['image/png'] });
      const { port } = new URL(app.url('/')) as unknown as AddressInfo & URL;

      const socket = connect(Number(port), '127.0.0.1');
      await new Promise((resolve) => socket.once('connect', resolve));
      socket.write(
        'POST /files HTTP/1.1\r\nHost: localhost\r\nContent-Type: multipart/form-data; boundary=x\r\nContent-Length: 100000\r\n\r\n' +
          '--x\r\nContent-Disposition: form-data; name="photo"; filename="a.png"\r\nContent-Type: image/png\r\n\r\npartial'
      );
      await sleep(100);
      assert.equal(uploadDirs().length, before + 1);

      socket.destroy();
      await sleep(200);

      assert.equal(uploadDirs().length, before);
      await app.close();
    });
  });

  describe('opciones', () => {
    it('rechaza configuraciones inválidas al declararlas', () => {
      assert.throws(() => Upload({ field: 'a' }), /types or check/);
      assert.throws(() => Upload({ field: 'a', types: [] }), /types or check/);
      assert.throws(() => Upload({ field: '', types: ['image/png'] }), /field cannot be empty/);
      assert.throws(() => Upload({ field: 'a', types: ['image/png'], maxFileSize: 0 }), /positive integers/);
      assert.throws(() => Upload({ field: 'a', types: ['image/png'], maxFiles: 1.5 }), /positive integers/);
      for (const type of ['text/csv', 'image/svg+xml', 'application/json']) {
        assert.throws(() => Upload({ field: 'a', types: [type] }), /use the check option/, type);
      }
    });
  });
});
