import { createClient } from '@libsql/client';
import { and, eq, like, lte } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';

import { DrizzleStorageRepository, type StorageModel } from 'laikacms/storage-drizzle';

import { atoms } from './schema.js';

async function ensureSchema(db: LibSQLDatabase): Promise<void> {
  await db.run(
    /* sql */ `CREATE TABLE IF NOT EXISTS atoms (
      key TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      depth INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  await db.run(/* sql */ `CREATE INDEX IF NOT EXISTS atoms_depth_key ON atoms (depth, key)`);
}

export async function createDrizzleStorage(dbUrl: string): Promise<DrizzleStorageRepository> {
  const client = createClient({ url: dbUrl });
  const db = drizzle(client);
  await ensureSchema(db);

  return new DrizzleStorageRepository({
    queryBuilders: {
      keyEquals: value => eq(atoms.key, value),
      keyStartsWith: prefix => like(atoms.key, `${prefix}%`),
      depthLte: value => lte(atoms.depth, value),
      and: (...conditions) => and(...(conditions as Parameters<typeof and>)),
    },
    /* eslint-disable @typescript-eslint/no-explicit-any */
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
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
}
