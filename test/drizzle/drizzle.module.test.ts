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
});
