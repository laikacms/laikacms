import { Database } from 'bun:sqlite';
import { and, eq, like, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { DrizzleStorageRepository, type StorageModel } from 'laikacms/storage-drizzle';

import { atoms } from './schema.js';

/**
 * Ensure the atoms table exists. Called once at server start — bun:sqlite
 * is synchronous so there's no await here. The file is created if it doesn't
 * exist yet (Bun's SQLite is embedded, no separate server process needed).
 *
 * Doc gap: DrizzleStorageRepository never runs DDL; callers own migrations.
 * For production, use drizzle-kit to generate and apply migration files.
 */
function ensureSchema(db: ReturnType<typeof drizzle>): void {
  db.run(/* sql */ `
    CREATE TABLE IF NOT EXISTS atoms (
      key         TEXT PRIMARY KEY NOT NULL,
      type        TEXT NOT NULL,
      content     TEXT NOT NULL,
      depth       INTEGER NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )
  `);
  db.run(/* sql */ `
    CREATE INDEX IF NOT EXISTS atoms_depth_key ON atoms (depth, key)
  `);
}

/**
 * Build a DrizzleStorageRepository backed by Bun's native SQLite.
 *
 * `bun:sqlite` is built into the Bun runtime — no npm package needed for
 * the database driver. `drizzle-orm/bun-sqlite` is the thin Drizzle adapter.
 *
 * Bun's SQLite is synchronous (same thread, no IPC). Drizzle wraps it in an
 * async interface via microtask scheduling, so it composes with Promise-based
 * code transparently.
 *
 * Doc gap: LaikaCMS docs only show Node.js/libsql for SQLite. Bun's native
 * SQLite works without any additional DB package — just bun + drizzle-orm.
 */
export function createBunSqliteStorage(dbPath: string): DrizzleStorageRepository {
  const sqlite = new Database(dbPath, { create: true });
  const db = drizzle(sqlite);
  ensureSchema(db);

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
