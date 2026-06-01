import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Schema for LaikaCMS atoms (documents and folders) in D1 / SQLite.
 *
 * Mirrors `StorageModel` from `laikacms/storage-drizzle`:
 *   key, type, content (JSON), depth, createdAt, updatedAt.
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
