import { and, eq, like, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { DrizzleStorageRepository, type StorageModel } from 'laikacms/storage-drizzle';

export const atoms = sqliteTable('atoms', {
  key: text('key').primaryKey().notNull(),
  type: text('type').notNull(),
  content: text('content').notNull(),
  depth: integer('depth').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Build a DrizzleStorageRepository backed by a Cloudflare D1 binding.
 *
 * Called per-request because Astro.locals.runtime.env is only available in a
 * Cloudflare request context — there is no module-level singleton pattern here.
 */
export function makeD1Storage(d1: D1Database): DrizzleStorageRepository {
  const db = drizzle(d1);

  return new DrizzleStorageRepository({
    queryBuilders: {
      keyEquals: (value: string) => eq(atoms.key, value),
      keyStartsWith: (prefix: string) => like(atoms.key, `${prefix}%`),
      depthLte: (value: number) => lte(atoms.depth, value),
      and: (...conditions) => and(...(conditions as Parameters<typeof and>)),
    },
    callbacks: {
      async insert({ values }) {
        const rows = await db.insert(atoms).values(values).returning();
        return rows as unknown as StorageModel[];
      },
      async update({ where, values }) {
        const rows = await db.update(atoms).set(values).where(where as any).returning();
        return rows as unknown as StorageModel[];
      },
      async delete({ where }) {
        const rows = await db.delete(atoms).where(where as any).returning();
        return rows as unknown as StorageModel[];
      },
      async select({ where, limit }) {
        const base = db.select().from(atoms).where(where as any);
        const rows = limit ? await base.limit(limit) : await base;
        return rows as unknown as StorageModel[];
      },
    },
  });
}
