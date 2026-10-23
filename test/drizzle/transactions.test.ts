import { eq, sql } from 'drizzle-orm';
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable, Module, createApp, inject, silentLogger, type App } from '../../src/index.ts';
import { DatabaseService, DrizzleModule, Transactional } from '../../src/drizzle/index.ts';

const connection = process.env.VIGA_TEST_DATABASE_URL;

const stock = pgTable('viga_tx_stock', {
  sku: text('sku').primaryKey(),
  quantity: integer('quantity').notNull(),
});

const movements = pgTable('viga_tx_movements', {
  id: serial('id').primaryKey(),
  sku: text('sku').notNull(),
  delta: integer('delta').notNull(),
});

class OutOfStock extends Error {}

@Injectable()
class StockRepository {
  private readonly database = inject(DatabaseService);

  async add(sku: string, delta: number) {
    const [row] = await this.database.db
      .update(stock)
      .set({ quantity: sql`${stock.quantity} + ${delta}` })
      .where(eq(stock.sku, sku))
      .returning();
    if (!row || row.quantity < 0) throw new OutOfStock(sku);
    return row.quantity;
  }
}

@Injectable()
class MovementRepository {
  private readonly database = inject(DatabaseService);

  record(sku: string, delta: number) {
    return this.database.db.insert(movements).values({ sku, delta });
  }
}

@Injectable()
class InventoryService {
  private readonly database = inject(DatabaseService);
  private readonly stockRepository = inject(StockRepository);
  private readonly movementRepository = inject(MovementRepository);

  move(sku: string, delta: number) {
    return this.database.transaction(async () => {
      await this.movementRepository.record(sku, delta);
      return this.stockRepository.add(sku, delta);
    });
  }

  @Transactional()
  async moveWithDecorator(sku: string, delta: number) {
    await this.movementRepository.record(sku, delta);
    return this.stockRepository.add(sku, delta);
  }

  async moveWithoutTransaction(sku: string, delta: number) {
    await this.movementRepository.record(sku, delta);
    return this.stockRepository.add(sku, delta);
  }
}

@Module({
  providers: [StockRepository, MovementRepository, InventoryService],
  exports: [InventoryService],
})
class InventoryModule {}

describe('transacciones de viga/drizzle con PostgreSQL', { skip: !connection && 'define VIGA_TEST_DATABASE_URL' }, () => {
  let app: App;
  let database: DatabaseService;
  let inventory: InventoryService;

  const quantityOf = async (sku: string) => {
    const [row] = await database.root.select().from(stock).where(eq(stock.sku, sku));
    return row?.quantity;
  };

  const movementsOf = async (sku: string) =>
    (await database.root.select().from(movements).where(eq(movements.sku, sku))).map((m) => m.delta);

  before(async () => {
    @Module({ imports: [DrizzleModule.forRoot({ connection: connection! }), InventoryModule] })
    class AppModule {}

    app = createApp({ rootModule: AppModule, logger: silentLogger });
    await app.init();
    database = app.get(DatabaseService);
    inventory = app.get(InventoryService);

    await database.root.execute(sql`drop table if exists viga_tx_movements, viga_tx_stock`);
    await database.root.execute(
      sql`create table viga_tx_stock (sku text primary key, quantity integer not null)`
    );
    await database.root.execute(
      sql`create table viga_tx_movements (id serial primary key, sku text not null, delta integer not null)`
    );
  });

  beforeEach(async () => {
    await database.root.execute(sql`truncate viga_tx_movements, viga_tx_stock`);
    await database.root.insert(stock).values([
      { sku: 'labial', quantity: 10 },
      { sku: 'crema', quantity: 5 },
    ]);
  });

  after(async () => {
    await database?.root.execute(sql`drop table if exists viga_tx_movements, viga_tx_stock`);
    await app?.close();
  });

  it('confirma juntas las escrituras de varios repositorios', async () => {
    assert.equal(await inventory.move('labial', 5), 15);

    assert.equal(await quantityOf('labial'), 15);
    assert.deepEqual(await movementsOf('labial'), [5]);
  });

  it('revierte todo si un paso falla', async () => {
    await assert.rejects(inventory.move('crema', -8), OutOfStock);

    assert.equal(await quantityOf('crema'), 5);
    assert.deepEqual(await movementsOf('crema'), []);
  });

  it('sin transacción cada escritura se confirma por separado', async () => {
    await assert.rejects(inventory.moveWithoutTransaction('crema', -8), OutOfStock);

    assert.deepEqual(await movementsOf('crema'), [-8]);
  });

  it('@Transactional() envuelve el método en una transacción', async () => {
    assert.equal(await inventory.moveWithDecorator('labial', -3), 7);
    await assert.rejects(inventory.moveWithDecorator('crema', -6), OutOfStock);

    assert.deepEqual(await movementsOf('labial'), [-3]);
    assert.equal(await quantityOf('crema'), 5);
    assert.deepEqual(await movementsOf('crema'), []);
  });

  it('una transacción anidada que falla solo revierte lo suyo si se captura el error', async () => {
    await database.transaction(async () => {
      await inventory.move('labial', 2);
      await assert.rejects(inventory.move('crema', -50), OutOfStock);
    });

    assert.equal(await quantityOf('labial'), 12);
    assert.equal(await quantityOf('crema'), 5);
    assert.deepEqual(await movementsOf('crema'), []);
  });

  it('una transacción anidada que falla sin capturar revierte la exterior', async () => {
    await assert.rejects(
      database.transaction(async () => {
        await inventory.move('labial', 2);
        await inventory.move('crema', -50);
      }),
      OutOfStock
    );

    assert.equal(await quantityOf('labial'), 10);
    assert.deepEqual(await movementsOf('labial'), []);
  });

  it('las operaciones de una transacción usan la misma conexión de PostgreSQL', async () => {
    const txid = () => database.db.execute(sql`select txid_current() as id`).then((r) => r.rows[0]?.id);

    const [first, second] = await database.transaction(async () => [await txid(), await txid()]);
    const outside = [await txid(), await txid()];

    assert.equal(first, second);
    assert.notEqual(outside[0], outside[1]);
  });

  it('inTransaction() y db reflejan la transacción en curso', async () => {
    assert.equal(database.inTransaction(), false);
    assert.equal(database.db, database.root);

    await database.transaction(async (tx) => {
      assert.equal(database.inTransaction(), true);
      assert.equal(database.db, tx);
    });

    assert.equal(database.inTransaction(), false);
  });

  it('transacciones simultáneas no comparten contexto', async () => {
    const results = await Promise.all([
      database.transaction(async (tx) => {
        await sleep(20);
        await inventory.move('labial', 1);
        return database.db === tx;
      }),
      database.transaction(async (tx) => {
        await inventory.move('crema', 1);
        return database.db === tx;
      }),
      (async () => {
        await sleep(5);
        return database.inTransaction();
      })(),
    ]);

    assert.deepEqual(results, [true, true, false]);
    assert.equal(await quantityOf('labial'), 11);
    assert.equal(await quantityOf('crema'), 6);
  });

  it('acepta el nivel de aislamiento en la transacción exterior', async () => {
    const level = await database.transaction(
      async () => (await database.db.execute(sql`show transaction_isolation`)).rows[0]?.transaction_isolation,
      { isolationLevel: 'serializable' }
    );

    assert.equal(level, 'serializable');
  });

  it('no deja cambiar la configuración en una transacción anidada', async () => {
    await assert.rejects(
      database.transaction(() => database.transaction(async () => 1, { isolationLevel: 'serializable' })),
      /nested transaction cannot change the configuration/
    );
  });
});
