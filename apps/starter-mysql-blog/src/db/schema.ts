import { int, mediumtext, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

export const atoms = mysqlTable('atoms', {
  key: varchar('key', { length: 255 }).primaryKey().notNull(),
  type: varchar('type', { length: 64 }).notNull(),
  content: mediumtext('content').notNull(),
  depth: int('depth').notNull(),
  createdAt: varchar('created_at', { length: 64 }).notNull(),
  updatedAt: varchar('updated_at', { length: 64 }).notNull(),
});

export type AtomRow = typeof atoms.$inferSelect;
