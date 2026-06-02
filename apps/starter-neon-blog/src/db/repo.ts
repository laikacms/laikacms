import { neon } from '@neondatabase/serverless';
import { and, eq, like, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';
import { DrizzleStorageRepository, type StorageModel } from 'laikacms/storage-drizzle';

import { atoms } from './schema.js';

/**
 * Ensure the atoms table exists. Neon's HTTP transport means this is a normal
 * SQL request — no local SQLite file to create. Run once at server start.
 *
 * Doc gap: DrizzleStorageRepository never runs DDL — callers are responsible
 * for migrations. This function handles the dev/quickstart case; production
 * should use a proper migration tool (drizzle-kit, flyway, etc.).
 */
async function ensureSchema(db: ReturnType<typeof drizzle>): Promise<void> {
  await db.execute(/* sql */ `
    CREATE TABLE IF NOT EXISTS atoms (
      key         TEXT PRIMARY KEY NOT NULL,
      type        TEXT NOT NULL,
      content     TEXT NOT NULL,
      depth       INTEGER NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )
  `);
  await db.execute(/* sql */ `
    CREATE INDEX IF NOT EXISTS atoms_depth_key ON atoms (depth, key)
  `);
}

/**
 * Build a DrizzleStorageRepository backed by Neon serverless Postgres.
 *
 * @neondatabase/serverless uses an HTTP transport so it works everywhere:
 * Node.js, Cloudflare Workers, Vercel Edge, AWS Lambda@Edge, Deno, Bun.
 * This is the key advantage over `pg` (which requires a TCP connection).
 *
 * The DrizzleStorageRepository uses IoC — we provide the query builders and
 * CRUD callbacks; it handles all LaikaCMS storage contract details.
 */
export async function createNeonStorage(databaseUrl: string): Promise<DrizzleStorageRepository> {
  const sql = neon(databaseUrl);
  const db = drizzle(sql);
  await ensureSchema(db);

  return new DrizzleStorageRepository({
    queryBuilders: {
      keyEquals: value => eq(atoms.key, value),
      keyStartsWith: prefix => like(atoms.key, `${prefix}%`),
      depthLte: value => lte(atoms.depth, value),
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
