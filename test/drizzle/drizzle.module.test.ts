import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Controller, Get, Injectable, Module, createApp, inject, silentLogger } from '../../src/index.ts';
import { DRIZZLE_OPTIONS, DatabaseService, DrizzleModule } from '../../src/drizzle/index.ts';

@Injectable()
class BooksRepository {
  readonly database = inject(DatabaseService);
}

@Controller('/books')
class BooksController {
  readonly books = inject(BooksRepository);

  @Get()
  list() {
    return [];
  }
}

@Module({ controllers: [BooksController], providers: [BooksRepository] })
class BooksModule {}

const connection = 'postgresql://viga:viga@127.0.0.1:1/viga';

describe('DrizzleModule', () => {
  it('es global: los módulos usan DatabaseService sin importarlo', async () => {
    @Module({ imports: [DrizzleModule.forRoot({ connection }), BooksModule] })
    class AppModule {}

    const app = createApp({ rootModule: AppModule, logger: silentLogger });
    await app.init();

    const database = app.get(DatabaseService);
    assert.ok(database.db);
    assert.equal(database.pool.options.connectionString, connection);
    assert.equal(app.get(DRIZZLE_OPTIONS).connection, connection);

    await app.close();
  });

  it('acepta la configuración completa del pool', async () => {
    @Module({
      imports: [DrizzleModule.forRoot({ connection: { connectionString: connection, max: 3 } })],
    })
    class AppModule {}

    const app = createApp({ rootModule: AppModule, logger: silentLogger });
    await app.init();

    assert.equal(app.get(DatabaseService).pool.options.max, 3);

    await app.close();
  });

  it('cierra el pool al cerrar la aplicación', async () => {
    @Module({ imports: [DrizzleModule.forRoot({ connection })] })
    class AppModule {}

    const app = createApp({ rootModule: AppModule, logger: silentLogger });
    await app.init();
    const { pool } = app.get(DatabaseService);

    await app.close();

    assert.equal(pool.ending, true);
  });

  it('registra en el logger los errores de conexiones inactivas sin tumbar el proceso', async () => {
    const logged: unknown[] = [];

    @Module({ imports: [DrizzleModule.forRoot({ connection })] })
    class AppModule {}

    const app = createApp({
      rootModule: AppModule,
      logger: { ...silentLogger, error: (...args: unknown[]) => logged.push(args) },
    });
    await app.init();

    app.get(DatabaseService).pool.emit('error', new Error('conexión perdida'));

    assert.equal(logged.length, 1);
    await app.close();
  });

  it('fija por defecto tiempos máximos para consultas, conexiones y transacciones inactivas', async () => {
    @Module({ imports: [DrizzleModule.forRoot({ connection })] })
    class DefaultModule {}

    @Module({
      imports: [
        DrizzleModule.forRoot({ connection: { connectionString: connection, statement_timeout: 5_000 } }),
      ],
    })
    class CustomModule {}

    for (const [Root, statementTimeout] of [
      [DefaultModule, 30_000],
      [CustomModule, 5_000],
    ] as const) {
      const app = createApp({ rootModule: Root, logger: silentLogger });
      await app.init();
      const { options } = app.get(DatabaseService).pool;

      assert.equal(options.statement_timeout, statementTimeout);
      assert.equal(options.connectionTimeoutMillis, 10_000);
      assert.equal(options.idle_in_transaction_session_timeout, 60_000);
      await app.close();
    }
  });

  describe('avisos de TLS', () => {
    const warningsFor = async (connection: string | Record<string, unknown>) => {
      const warnings: string[] = [];

      @Module({ imports: [DrizzleModule.forRoot({ connection })] })
      class AppModule {}

      const app = createApp({
        rootModule: AppModule,
        logger: { ...silentLogger, warn: (message) => warnings.push(message) },
      });
      await app.init();
      await app.close();
      return warnings;
    };

    it('avisa si se conecta sin TLS a un host que no es local', async () => {
      const warnings = await warningsFor('postgresql://viga:viga@db.example.com:1/viga');

      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /db\.example\.com without TLS/);
      assert.doesNotMatch(warnings[0]!, /viga:viga/);
    });

    it('avisa si TLS no verifica el certificado', async () => {
      const unverified = { host: 'db.example.com', port: 1, ssl: { rejectUnauthorized: false } };
      const warnings = await warningsFor(unverified);

      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /does not verify the server certificate/);
    });

    it('no avisa con TLS verificado ni con una base de datos local', async () => {
      const verified = 'postgresql://viga@db.example.com:1/viga?sslmode=verify-full';
      assert.deepEqual(await warningsFor(verified), []);
      assert.deepEqual(await warningsFor({ host: 'db.example.com', port: 1, ssl: true }), []);
      assert.deepEqual(await warningsFor(connection), []);
      assert.deepEqual(await warningsFor('postgresql://viga@localhost:1/viga'), []);
      assert.deepEqual(await warningsFor({ host: '/var/run/postgresql' }), []);
    });
  });
});
