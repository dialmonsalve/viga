import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import {
  Injectable,
  Module,
  createApp,
  inject,
  silentLogger,
  type StandardSchemaV1,
} from '../../src/index.ts';
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

  it('identifica errores de todo el objeto y oculta valores cortos sin romper el mensaje', async () => {
    const Ports = z
      .object({ FROM: z.coerce.number(), TO: z.coerce.number() })
      .refine((env) => env.FROM < env.TO, { error: 'FROM must be lower than TO' });
    const Short = z.object({
      MODE: z.string().refine(() => false, { error: (issue) => `MODE "${String(issue.input)}" is not allowed` }),
    });

    @Module({ imports: [ConfigModule.forRoot({ schema: Ports, env: { FROM: '9', TO: '1' } })] })
    class PortsModule {}

    @Module({ imports: [ConfigModule.forRoot({ schema: Short, env: { MODE: 'ab' } })] })
    class ShortModule {}

    await assert.rejects(
      createApp({ rootModule: PortsModule, logger: silentLogger }).init(),
      /- \(root\): FROM must be lower than TO/
    );
    await assert.rejects(
      createApp({ rootModule: ShortModule, logger: silentLogger }).init(),
      /- MODE: MODE "\*\*\*" is not allowed/
    );
  });

  it('oculta el valor en la ruta completa de una fuente anidada', async () => {
    const custom: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'custom',
        validate: () => ({
          issues: [{ message: 'key s3cr3t-key about to expire', path: ['db', { key: 'key' }] }],
        }),
      },
    };

    @Module({ imports: [ConfigModule.forRoot({ schema: custom, env: { db: { key: 's3cr3t-key' } } })] })
    class NestedModule {}

    await assert.rejects(
      createApp({ rootModule: NestedModule, logger: silentLogger }).init(),
      (error: Error) => {
        assert.match(error.message, /- db\.key: key \*\*\* about to expire/);
        assert.doesNotMatch(error.message, /s3cr3t/);
        return true;
      }
    );
  });

  it('congela la configuración en profundidad', async () => {
    const Nested = z
      .object({ DATABASE_URL: z.url() })
      .transform((env) => ({ db: { url: env.DATABASE_URL }, hosts: ['a'] }));

    @Module({ imports: [ConfigModule.forRoot({ schema: Nested, env: VALID })] })
    class NestedModule {}

    const app = createApp({ rootModule: NestedModule, logger: silentLogger });
    await app.init();
    const config = app.get(CONFIG) as unknown as { db: { url: string }; hosts: string[] };

    assert.throws(() => {
      config.db.url = 'postgres://evil';
    }, TypeError);
    assert.throws(() => config.hosts.push('b'), TypeError);
    await app.close();
  });

  it('entiende los errores de cualquier librería Standard Schema', async () => {
    const custom: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'custom',
        validate: () => ({
          issues: [
            { message: 'TOKEN supersecreto-123 is revoked', path: [{ key: 'TOKEN' }] },
            { message: 'something else is wrong' },
          ],
        }),
      },
    };

    @Module({ imports: [ConfigModule.forRoot({ schema: custom, env: { TOKEN: 'supersecreto-123' } })] })
    class CustomModule {}

    await assert.rejects(
      createApp({ rootModule: CustomModule, logger: silentLogger }).init(),
      (error: Error) => {
        assert.match(error.message, /- TOKEN: TOKEN \*\*\* is revoked/);
        assert.match(error.message, /- \(root\): something else is wrong/);
        assert.doesNotMatch(error.message, /supersecreto/);
        return true;
      }
    );
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
