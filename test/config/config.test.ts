import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { Injectable, Module, createApp, inject, silentLogger } from '../../src/index.ts';
import { CONFIG, ConfigModule } from '../../src/config/index.ts';

const Env = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.url(),
  JWT_SECRET: z
    .string()
    .min(32)
    .refine((value) => !value.startsWith('changeme'), {
      error: (issue) => `JWT_SECRET "${String(issue.input)}" is a placeholder`,
    }),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

declare module '../../src/config/index.ts' {
  interface Register {
    schema: typeof Env;
  }
}

const VALID = {
  DATABASE_URL: 'postgres://viga@localhost:5432/viga',
  JWT_SECRET: 'x'.repeat(40),
  PORT: '8080',
  UNRELATED_SECRET: 'no-debe-aparecer',
};

@Injectable()
class AuthService {
  readonly config = inject(CONFIG);

  describe() {
    const port: number = this.config.PORT;
    const env: 'development' | 'production' | 'test' = this.config.NODE_ENV;
    return { port, env };
  }
}

@Module({ providers: [AuthService], exports: [AuthService] })
class AuthModule {}

async function boot(env: Record<string, unknown>) {
  @Module({ imports: [ConfigModule.forRoot({ schema: Env, env }), AuthModule] })
  class AppModule {}

  const app = createApp({ rootModule: AppModule, logger: silentLogger });
  await app.init();
  return app;
}

describe('ConfigModule', () => {
  it('valida, convierte y tipa la configuración, y la comparte con todos los módulos', async () => {
    const app = await boot(VALID);

    try {
      const auth = app.get(AuthService);
      assert.deepEqual(auth.describe(), { port: 8080, env: 'development' });
      assert.equal(app.get(CONFIG).DATABASE_URL, VALID.DATABASE_URL);
    } finally {
      await app.close();
    }
  });

  it('solo contiene las claves declaradas y no se puede modificar', async () => {
    const app = await boot(VALID);

    try {
      const config = app.get(CONFIG);
      assert.equal('UNRELATED_SECRET' in config, false);
      assert.ok(Object.isFrozen(config));
      assert.throws(() => {
        (config as { PORT: number }).PORT = 1;
      }, TypeError);
    } finally {
      await app.close();
    }
  });

  it('no arranca si falta o es inválida alguna variable, y dice cuáles', async () => {
    await assert.rejects(
      boot({ PORT: 'abc', JWT_SECRET: 'corto' }),
      (error: Error) => {
        assert.match(error.message, /^\[Config\] Invalid configuration:/);
        assert.match(error.message, /- PORT: /);
        assert.match(error.message, /- DATABASE_URL: /);
        assert.match(error.message, /- JWT_SECRET: /);
        return true;
      }
    );
  });

  it('nunca muestra el valor de una variable en el error', async () => {
    const secret = `changeme-${'s'.repeat(40)}`;

    await assert.rejects(boot({ ...VALID, JWT_SECRET: secret }), (error: Error) => {
      assert.match(error.message, /JWT_SECRET: JWT_SECRET "\*\*\*" is a placeholder/);
      assert.doesNotMatch(error.message, /changeme/);
      return true;
    });
  });

  it('usa process.env si no se indica otra fuente', async () => {
    const previous = { ...process.env };
    Object.assign(process.env, {
      DATABASE_URL: VALID.DATABASE_URL,
      JWT_SECRET: VALID.JWT_SECRET,
      PORT: '9090',
    });

    @Module({ imports: [ConfigModule.forRoot({ schema: Env }), AuthModule] })
    class AppModule {}

    const app = createApp({ rootModule: AppModule, logger: silentLogger });
    try {
      await app.init();
      assert.equal(app.get(CONFIG).PORT, 9090);
    } finally {
      await app.close();
      for (const key of ['DATABASE_URL', 'JWT_SECRET', 'PORT']) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });

  it('rechaza un schema que valida de forma asíncrona', async () => {
    const AsyncEnv = z.object({ A: z.string() }).refine(async () => true);

    @Module({ imports: [ConfigModule.forRoot({ schema: AsyncEnv, env: { A: 'x' } })] })
    class AppModule {}

    const app = createApp({ rootModule: AppModule, logger: silentLogger });
    await assert.rejects(app.init(), /must validate synchronously/);
  });
});
