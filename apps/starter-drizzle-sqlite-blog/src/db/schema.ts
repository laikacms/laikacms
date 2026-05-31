import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Schema for LaikaCMS atoms in SQLite.
 * Mirrors `StorageModel` from `laikacms/storage-drizzle`.
 */
export const atoms = sqliteTable('atoms', {
  key: text('key').primaryKey().notNull(),
  type: text('type').notNull(),
  content: text('content').notNull(),
  depth: integer('depth').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type AtomRow = typeof atoms.$inferSelect;
