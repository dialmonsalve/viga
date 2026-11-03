import { pgTable, serial, text } from 'drizzle-orm/pg-core';
import { inject } from '@vigajs/core';
import { CONFIG } from '@vigajs/core/config';
import { DatabaseService } from '@vigajs/core/drizzle';
import { z } from 'zod';

const Env = z.object({ NAME: z.string() });
const schema = { books: pgTable('books', { id: serial('id').primaryKey(), title: text('title').notNull() }) };

declare module '@vigajs/core/config' {
  interface Register {
    schema: typeof Env;
  }
}

declare module '@vigajs/core/drizzle' {
  interface Register {
    schema: typeof schema;
  }
}

export const name: string = inject(CONFIG).NAME;
export const books = () => inject(DatabaseService).db.query.books.findMany();

// @ts-expect-error unknown keys must not exist on the registered config
export const missing = inject(CONFIG).OTHER;
