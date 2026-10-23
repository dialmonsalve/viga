import type { PgDatabase } from 'drizzle-orm/pg-core';
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import pg, { type PoolConfig } from 'pg';
import { createContextKey } from '../context.ts';
import { Injectable } from '../decorators/injectable.ts';
import { InjectionToken, inject } from '../di/injector.ts';
import type { OnModuleDestroy } from '../di/lifecycle.ts';
import { LOGGER } from '../logger.ts';
import { diagnostic } from '../diagnostics.ts';

export interface Register {}

export type RegisteredSchema = Register extends { schema: infer S extends Record<string, unknown> }
  ? S
  : Record<string, never>;

export type Database = NodePgDatabase<RegisteredSchema>;
export type Executor = PgDatabase<NodePgQueryResultHKT, RegisteredSchema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type TransactionConfig = NonNullable<Parameters<Database['transaction']>[1]>;

export interface DrizzleOptions {
  connection: string | PoolConfig;
  schema?: Record<string, unknown>;
}

export const DRIZZLE_OPTIONS = new InjectionToken<DrizzleOptions>('DRIZZLE_OPTIONS');

function poolConfig(connection: string | PoolConfig): PoolConfig {
  return typeof connection === 'string' ? { connectionString: connection } : connection;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly options = inject(DRIZZLE_OPTIONS);
  private readonly logger = inject(LOGGER);
  private readonly currentTransaction = createContextKey<Transaction>('drizzle.transaction');
  readonly pool = new pg.Pool(poolConfig(this.options.connection));
  readonly root = drizzle({
    client: this.pool,
    schema: this.options.schema as RegisteredSchema | undefined,
  }) as Database;

  constructor() {
    this.pool.on('error', (error) => {
      this.logger.error(diagnostic('drizzle.idleClientError'), error);
    });
  }

  get db(): Executor {
    return this.currentTransaction.find() ?? this.root;
  }

  inTransaction(): boolean {
    return this.currentTransaction.find() !== undefined;
  }

  transaction<T>(work: (tx: Transaction) => Promise<T>, config?: TransactionConfig): Promise<T> {
    const current = this.currentTransaction.find();
    const run = (tx: Transaction) => this.currentTransaction.run(tx, () => work(tx));

    if (!current) return this.root.transaction(run, config);

    if (config) {
      throw new Error(diagnostic('drizzle.nestedTransactionConfig'));
    }
    return current.transaction(run);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
