import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { z } from 'zod';
import { Controller, HttpCode, Module, Post, Public, type HttpContext } from '../../src/index.ts';
import { createTestingApp } from '../../src/testing/index.ts';
import { Validate } from '../../src/validation/index.ts';

const WithValibot = v.object({
  title: v.pipe(v.string(), v.minLength(3)),
  author: v.object({ email: v.pipe(v.string(), v.email()) }),
});
const WithZod = z.object({ title: z.string().min(3) });
const NoCode = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: () => ({ issues: [{ message: 'Invalid' }] }),
  },
} as const;
const NumericType = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: () => ({ issues: [{ message: 'Invalid', type: 7 }] }),
  },
} as const;

interface ErrorBody {
  details: { body: { path: string; code?: string; message: string }[] };
}

@Public()
@Controller('/check')
class CheckController {
  @Post('/valibot')
  @HttpCode(200)
  @Validate({ body: WithValibot })
  valibot({ body }: HttpContext<{ body: typeof WithValibot }>) {
    return body;
  }

  @Post('/zod')
  @HttpCode(200)
  @Validate({ body: WithZod })
  zod({ body }: HttpContext<{ body: typeof WithZod }>) {
    return body;
  }

  @Post('/none')
  @Validate({ body: NoCode })
  none() {}

  @Post('/numeric')
  @Validate({ body: NumericType })
  numeric() {}
}

@Module({ controllers: [CheckController] })
class AppModule {}

describe('códigos de error de validación', () => {
  it('Valibot rellena code con su campo type', async () => {
    const app = await createTestingApp(AppModule);

    const { status, body } = await app.request<ErrorBody>('/check/valibot', {
      method: 'POST',
      json: { title: 'a', author: { email: 'nope' } },
    });

    assert.equal(status, 400);
    assert.deepEqual(body.details.body.map(({ path, code }) => ({ path, code })), [
      { path: 'title', code: 'min_length' },
      { path: 'author.email', code: 'email' },
    ]);
    await app.close();
  });

  it('Zod sigue usando su campo code', async () => {
    const app = await createTestingApp(AppModule);

    const { body } = await app.request<ErrorBody>('/check/zod', { method: 'POST', json: { title: 'a' } });

    assert.equal(body.details.body[0]?.code, 'too_small');
    await app.close();
  });

  it('sin un código de texto, el error no lleva code', async () => {
    const app = await createTestingApp(AppModule);

    for (const path of ['/check/none', '/check/numeric']) {
      const { body } = await app.request<ErrorBody>(path, { method: 'POST', json: {} });
      assert.equal('code' in (body.details.body[0] ?? {}), false, path);
    }
    await app.close();
  });
});
