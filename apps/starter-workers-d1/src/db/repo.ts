import { and, eq, like, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { DrizzleStorageRepository, type StorageModel } from 'laikacms/storage-drizzle';

import { atoms } from './schema.js';

/**
 * Build a DrizzleStorageRepository backed by a Cloudflare D1 database.
 *
 * Called per-request inside the Workers handler since the D1 binding (`env.DB`)
 * is available only within a request context. The instantiation cost is negligible
 * — no TCP connection, no auth handshake; D1 is SQLite-native in the isolate.
 *
 * The DrizzleStorageRepository uses inversion-of-control: we provide
 * framework-specific query builders and async CRUD callbacks; it handles
 * all the LaikaCMS storage contract details.
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = await db.update(atoms).set(values).where(where as any).returning();
        return rows as unknown as StorageModel[];
      },
      async delete({ where }) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = await db.delete(atoms).where(where as any).returning();
        return rows as unknown as StorageModel[];
      },
      async select({ where, limit }) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const base = db.select().from(atoms).where(where as any);
        const rows = limit ? await base.limit(limit) : await base;
        return rows as unknown as StorageModel[];
      },
    },
  });
}
