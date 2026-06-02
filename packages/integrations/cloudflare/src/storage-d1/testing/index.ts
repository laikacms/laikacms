import type { StorageContractCase } from 'laikacms/storage/testing';

import { D1StorageRepository, schemaDdl } from '../d1-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory D1 mock.
//
// Implements the Cloudflare D1 REST API shape:
//   POST /accounts/:accountId/d1/database/:databaseId/query
//   Body:  { sql: string, params: unknown[] }
//   Reply: { success: true, result: [{ results: Row[], meta: { changes: number } }] }
//
// Uses a Map-backed SQLite-like store keyed by (parent_key, name).
// ---------------------------------------------------------------------------

const ACCOUNT_ID = 'test-account';
const DATABASE_ID = 'test-db';
const API_URL = 'https://d1-mock.test/client/v4';
const API_TOKEN = 'test-token';
const TABLE = 'laika_storage';

interface Row {
  parent_key: string;
  name: string;
  type: 'file' | 'folder';
  extension: string | null;
  content: string | null;
  created_at: string;
  updated_at: string;
  etag: string;
}

const rowKey = (parentKey: string, name: string): string => `${parentKey}\x00${name}`;

const createMockD1 = () => {
  const store = new Map<string, Row>();

  // Execute SQL against the in-memory store. Handles the subset of SQL the
  // D1StorageRepository emits: SELECT * WHERE parent_key = ? (AND name = ?)
  // (AND name LIKE ?), INSERT OR REPLACE INTO …, DELETE WHERE …, CREATE TABLE.
  const execute = (
    sql: string,
    params: unknown[],
  ): { results: Row[], changes: number } => {
    const trimmed = sql.replace(/\s+/g, ' ').trim();

    // CREATE TABLE IF NOT EXISTS — no-op in our in-memory store.
    if (/^CREATE TABLE/i.test(trimmed)) return { results: [], changes: 0 };

    // SELECT * FROM "laika_storage" WHERE parent_key = ? AND name = ?
    const selectByParentAndName = trimmed.match(
      /^SELECT \* FROM "[^"]+" WHERE parent_key = \? AND name = \?$/i,
    );
    if (selectByParentAndName) {
      const parentKey = String(params[0] ?? '');
      const name = String(params[1] ?? '');
      const row = store.get(rowKey(parentKey, name));
      return { results: row ? [row] : [], changes: 0 };
    }

    // SELECT * FROM "laika_storage" WHERE parent_key = ? AND name LIKE ?
    const selectByParentAndNameLike = trimmed.match(
      /^SELECT \* FROM "[^"]+" WHERE parent_key = \? AND name LIKE \?$/i,
    );
    if (selectByParentAndNameLike) {
      const parentKey = String(params[0] ?? '');
      const pattern = String(params[1] ?? '');
      // LIKE pattern is `<name>.%` — match by prefix before the `%`.
      const prefix = pattern.slice(0, pattern.lastIndexOf('%'));
      const results: Row[] = [];
      for (const row of store.values()) {
        if (row.parent_key === parentKey && row.name.startsWith(prefix)) {
          results.push(row);
        }
      }
      return { results, changes: 0 };
    }

    // SELECT * FROM "laika_storage" WHERE parent_key = ?
    const selectByParent = trimmed.match(
      /^SELECT \* FROM "[^"]+" WHERE parent_key = \?$/i,
    );
    if (selectByParent) {
      const parentKey = String(params[0] ?? '');
      const results: Row[] = [];
      for (const row of store.values()) {
        if (row.parent_key === parentKey) results.push(row);
      }
      return { results, changes: 0 };
    }

    // SELECT 1 FROM "laika_storage" WHERE parent_key = ? LIMIT 1
    const selectOneByParent = trimmed.match(
      /^SELECT 1 FROM "[^"]+" WHERE parent_key = \? LIMIT 1$/i,
    );
    if (selectOneByParent) {
      const parentKey = String(params[0] ?? '');
      for (const row of store.values()) {
        if (row.parent_key === parentKey) return { results: [row], changes: 0 };
      }
      return { results: [], changes: 0 };
    }

    // INSERT OR REPLACE INTO "laika_storage" (…) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    const insert = trimmed.match(/^INSERT OR REPLACE INTO "[^"]+" \(([^)]+)\) VALUES \([^)]+\)$/i);
    if (insert) {
      const cols = insert[1]!.split(',').map(c => c.trim());
      const row: Record<string, unknown> = {};
      for (let i = 0; i < cols.length; i++) {
        row[cols[i]!] = params[i] ?? null;
      }
      const r = row as unknown as Row;
      store.set(rowKey(r.parent_key, r.name), r);
      return { results: [], changes: 1 };
    }

    // DELETE FROM "laika_storage" WHERE parent_key = ? AND name = ?
    const del = trimmed.match(
      /^DELETE FROM "[^"]+" WHERE parent_key = \? AND name = \?$/i,
    );
    if (del) {
      const parentKey = String(params[0] ?? '');
      const name = String(params[1] ?? '');
      const had = store.delete(rowKey(parentKey, name));
      return { results: [], changes: had ? 1 : 0 };
    }

    throw new Error(`D1 mock: unrecognised SQL: ${trimmed.slice(0, 200)}`);
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const expectedPath = `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;
    const u = new URL(url);
    if (u.pathname !== expectedPath) return new Response('not found', { status: 404 });

    let body: { sql: string, params?: unknown[] };
    try {
      body = JSON.parse((init?.body as string) ?? '{}') as typeof body;
    } catch {
      return new Response('bad request', { status: 400 });
    }

    try {
      const { results, changes } = execute(body.sql ?? '', body.params ?? []);
      return new Response(
        JSON.stringify({
          success: true,
          result: [{ results, success: true, meta: { changes } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, errors: [{ message: (err as Error).message }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
  };

  return { fetchImpl, store };
};

const serializerRegistry = {
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as unknown,
  },
};

export const d1ContractCase: StorageContractCase = {
  name: 'D1StorageRepository',
  async makeRepo() {
    const { fetchImpl } = createMockD1();
    // Pre-run DDL so the repo finds the table.
    void schemaDdl(TABLE);
    return new D1StorageRepository({
      auth: { apiToken: API_TOKEN },
      accountId: ACCOUNT_ID,
      databaseId: DATABASE_ID,
      apiUrl: API_URL,
      tableName: TABLE,
      fetch: fetchImpl,
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'json',
    });
  },
};
