import { and, eq, like, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import { DrizzleStorageRepository, type StorageModel } from 'laikacms/storage-drizzle';

import { atoms } from './schema.js';

async function ensureSchema(pool: mysql.Pool): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS atoms (
        \`key\` VARCHAR(255) NOT NULL PRIMARY KEY,
        \`type\` VARCHAR(64) NOT NULL,
        \`content\` MEDIUMTEXT NOT NULL,
        \`depth\` INT NOT NULL,
        \`created_at\` VARCHAR(64) NOT NULL,
        \`updated_at\` VARCHAR(64) NOT NULL
      )
    `);
    // MySQL 8.0 doesn't support CREATE INDEX IF NOT EXISTS — swallow duplicate error
    try {
      await conn.execute('CREATE INDEX atoms_depth_key ON atoms (depth, `key`(255))');
    } catch {
      // index already exists — safe to ignore
    }
  } finally {
    conn.release();
  }
}

export async function createDrizzleStorage(databaseUrl: string): Promise<DrizzleStorageRepository> {
  const pool = mysql.createPool(databaseUrl);
  await ensureSchema(pool);
  const db = drizzle(pool);

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
        // MySQL has no RETURNING clause — re-select by primary key after insert
        await db.insert(atoms).values(values);
        const rows = await db.select().from(atoms).where(eq(atoms.key, values.key));
        return rows as unknown as StorageModel[];
      },
      async update({ where, values }) {
        await db.update(atoms).set(values).where(where as any);
        const rows = await db.select().from(atoms).where(where as any);
        return rows as unknown as StorageModel[];
      },
      async delete({ where }) {
        // Capture rows before deletion since MySQL has no RETURNING
        const rows = await db.select().from(atoms).where(where as any);
        await db.delete(atoms).where(where as any);
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
