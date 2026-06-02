import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Schema for LaikaCMS atoms (objects and folders) in SQLite.
 *
 * The shape mirrors `StorageModel` from `laikacms/storage-drizzle`:
 *   key, type, content (JSON string), depth, createdAt, updatedAt.
 *
 * `key` is the natural primary key. `depth` indexes the segment count so
 * folder traversals can filter by depth without scanning every row.
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
