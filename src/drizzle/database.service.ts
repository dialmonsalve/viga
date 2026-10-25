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

const POOL_DEFAULTS: PoolConfig = {
  statement_timeout: 30_000,
  connectionTimeoutMillis: 10_000,
  idle_in_transaction_session_timeout: 60_000,
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function poolConfig(connection: string | PoolConfig): PoolConfig {
  const config = typeof connection === 'string' ? { connectionString: connection } : connection;
  return { ...POOL_DEFAULTS, ...config };
}

function parseUrl(connectionString: string | undefined) {
  if (!connectionString) return undefined;
  try {
    return new URL(connectionString);
  } catch {
    return undefined;
  }
}

function tlsProblem(config: PoolConfig) {
  const url = parseUrl(config.connectionString);
  const host = config.host ?? (url?.hostname || undefined) ?? process.env.PGHOST ?? 'localhost';
  const sslMode = url?.searchParams.get('sslmode');
  const sslParam = url?.searchParams.get('ssl');
  const ssl = config.ssl ?? (sslMode ? sslMode !== 'disable' : sslParam === 'true' || sslParam === '1');

  if (typeof ssl === 'object' && ssl.rejectUnauthorized === false) {
    return diagnostic('drizzle.unverifiedTls');
  }
  if (ssl || host.startsWith('/') || LOCAL_HOSTS.has(host)) return undefined;
  return diagnostic('drizzle.insecureConnection', { host });
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
    const problem = tlsProblem(this.pool.options);
    if (problem) this.logger.warn(problem);
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
