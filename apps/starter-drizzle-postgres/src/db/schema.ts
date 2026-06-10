import { integer, pgTable, text } from 'drizzle-orm/pg-core';

export const atoms = pgTable('atoms', {
  key: text('key').primaryKey().notNull(),
  type: text('type').notNull(),
  content: text('content').notNull(),
  depth: integer('depth').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type AtomRow = typeof atoms.$inferSelect;
