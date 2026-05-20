import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { D1StorageRepository } from './d1-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory Cloudflare D1 mock — handles the specific SQL the repository
// emits. The mock parses each statement into a small action graph rather
// than running real SQL, so the test stays self-contained and fast.
//
// Patterns supported:
//   SELECT * FROM "<t>" WHERE parent_key = ? AND name = ?
//   SELECT * FROM "<t>" WHERE parent_key = ?
//   SELECT * FROM "<t>" WHERE parent_key = ? AND name LIKE ?
//   SELECT 1 FROM "<t>" WHERE parent_key = ? LIMIT 1
//   INSERT OR REPLACE INTO "<t>" (cols...) VALUES (?, ?, ...)
//   DELETE FROM "<t>" WHERE parent_key = ? AND name = ?
// ---------------------------------------------------------------------------

const ACCOUNT_ID = 'acct';
const DATABASE_ID = 'db';
const TABLE = 'laika_storage';
const API_URL = 'https://mock.cloudflare.test/client/v4';

interface Row {
  parent_key: string;
  name: string;
  type: string;
  extension: string | null;
  content: string | null;
  created_at: string;
  updated_at: string;
  etag: string;
}

const rowKey = (parentKey: string, name: string): string => `${parentKey}${name}`;

const COLUMNS = ['parent_key', 'name', 'type', 'extension', 'content', 'created_at', 'updated_at', 'etag'] as const;

const createMockD1 = () => {
  const rows = new Map<string, Row>();

  const okEnvelope = (results: Row[], changes = 0) => ({
    success: true,
    errors: [],
    result: [{ success: true, results, meta: { changes, rows_written: results.length } }],
  });

  const errEnvelope = (message: string) => ({
    success: false,
    errors: [{ message }],
    result: [],
  });

  const matchSqlAndRun = (sql: string, params: unknown[]): Row[] | { changes: number } => {
    const text = sql.trim();

    // SELECT 1 FROM ... LIMIT 1 — emptiness probe
    if (/^SELECT\s+1\s+FROM\s+"[^"]+"\s+WHERE\s+parent_key\s*=\s*\?\s+LIMIT\s+1$/i.test(text)) {
      const parent = String(params[0]);
      const found = [...rows.values()].find(r => r.parent_key === parent);
      return found ? [{ ...found }] : [];
    }

    // SELECT * FROM ... WHERE parent_key = ? AND name = ?
    if (/^SELECT\s+\*\s+FROM\s+"[^"]+"\s+WHERE\s+parent_key\s*=\s*\?\s+AND\s+name\s*=\s*\?$/i.test(text)) {
      const row = rows.get(rowKey(String(params[0]), String(params[1])));
      return row ? [{ ...row }] : [];
    }

    // SELECT * FROM ... WHERE parent_key = ? AND name LIKE ?
    if (/^SELECT\s+\*\s+FROM\s+"[^"]+"\s+WHERE\s+parent_key\s*=\s*\?\s+AND\s+name\s+LIKE\s+\?$/i.test(text)) {
      const parent = String(params[0]);
      const pattern = String(params[1]);
      // Translate SQL LIKE to a JS regex (% → .*, _ → .)
      const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$');
      return [...rows.values()].filter(r => r.parent_key === parent && re.test(r.name));
    }

    // SELECT * FROM ... WHERE parent_key = ?
    if (/^SELECT\s+\*\s+FROM\s+"[^"]+"\s+WHERE\s+parent_key\s*=\s*\?$/i.test(text)) {
      const parent = String(params[0]);
      return [...rows.values()].filter(r => r.parent_key === parent).map(r => ({ ...r }));
    }

    // INSERT OR REPLACE INTO ... (...) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    if (/^INSERT\s+OR\s+REPLACE\s+INTO\s+"[^"]+"\s+\([^)]+\)\s+VALUES\s+\([^)]+\)$/i.test(text)) {
      const [parent_key, name, type, extension, content, created_at, updated_at, etag] = params;
      const row: Row = {
        parent_key: String(parent_key),
        name: String(name),
        type: String(type),
        extension: extension === null || extension === undefined ? null : String(extension),
        content: content === null || content === undefined ? null : String(content),
        created_at: String(created_at),
        updated_at: String(updated_at),
        etag: String(etag),
      };
      const existed = rows.has(rowKey(row.parent_key, row.name));
      rows.set(rowKey(row.parent_key, row.name), row);
      return { changes: existed ? 1 : 1 };
    }

    // DELETE FROM ... WHERE parent_key = ? AND name = ?
    if (/^DELETE\s+FROM\s+"[^"]+"\s+WHERE\s+parent_key\s*=\s*\?\s+AND\s+name\s*=\s*\?$/i.test(text)) {
      const removed = rows.delete(rowKey(String(params[0]), String(params[1])));
      return { changes: removed ? 1 : 0 };
    }

    throw new Error(`unhandled SQL in mock: ${text}`);
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const expected = `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;
    if (url.pathname !== expected) return new Response('bad route', { status: 404 });

    const body = JSON.parse((init?.body as string) ?? '{}') as { sql: string; params: unknown[] };

    try {
      const result = matchSqlAndRun(body.sql, body.params ?? []);
      if (Array.isArray(result)) {
        return new Response(JSON.stringify(okEnvelope(result, 0)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(okEnvelope([], result.changes)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(
        JSON.stringify(errEnvelope(String((error as Error).message))),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
  };

  // unused — but exported for completeness
  void COLUMNS;

  return { rows, fetch: fetchImpl };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let mock: ReturnType<typeof createMockD1>;

beforeEach(() => { mock = createMockD1(); });
afterEach(() => { mock.rows.clear(); });

const makeRepo = (tableName?: string) =>
  new D1StorageRepository({
    auth: { apiToken: 'cf-test-token' },
    accountId: ACCOUNT_ID,
    databaseId: DATABASE_ID,
    apiUrl: API_URL,
    fetch: mock.fetch,
    tableName,
    serializerRegistry: {
      md: {
        format: { mediaType: 'text/markdown' } as never,
        serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
        deserializeDocumentFileContents: async raw => ({ body: raw }),
      },
    },
    defaultFileExtension: 'md',
  });

const seedFile = (parentKey: string, name: string, content: string, extension = 'md') => {
  const key = `${parentKey}${name}`;
  mock.rows.set(key, {
    parent_key: parentKey,
    name,
    type: 'file',
    extension,
    content,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    etag: `seed-${name}`,
  });
};

const seedFolder = (parentKey: string, name: string) => {
  const key = `${parentKey}${name}`;
  mock.rows.set(key, {
    parent_key: parentKey,
    name,
    type: 'folder',
    extension: null,
    content: null,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    etag: `seed-folder-${name}`,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('D1StorageRepository constructor', () => {
  it('rejects table names that could break the SQL (no parameter binding for identifiers)', () => {
    expect(() => makeRepo('not safe; DROP TABLE x; --')).toThrow(/^.*tableName.*A-Za-z/);
  });
});

describe('D1StorageRepository CRUD', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    expect(created.metadata?.revisionId).toBeTruthy();
    expect(mock.rows.get(`hello.md`)?.content).toBe('hi');

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });
    expect(updated.metadata?.revisionId).not.toBe(created.metadata?.revisionId);

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect(mock.rows.has(`hello.md`)).toBe(false);
  });

  it('auto-creates ancestor folder rows for deep keys', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c', content: { body: 'deep' } }),
    );

    expect(mock.rows.get('a')?.type).toBe('folder');
    expect(mock.rows.get('ab')?.type).toBe('folder');
    expect(mock.rows.get('a/bc.md')?.type).toBe('file');
  });

  it('rejects a duplicate createObject for the same key', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'one' } }),
    );
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'hello', content: { body: 'two' } }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('refuses to delete a non-empty folder (recoverable warning, not fatal)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'x' } }),
    );

    const attempt = await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes']));
    expect(attempt.data).toEqual([]);
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
    expect(mock.rows.get('notes')?.type).toBe('folder');
  });
});

describe('D1StorageRepository listing', () => {
  it('sorts numeric filenames naturally and strips extensions', async () => {
    seedFile('', '1.md', 'a');
    seedFile('', '2.md', 'b');
    seedFile('', '10.md', 'c');
    seedFile('', '11.md', 'd');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10', '11']);
  });

  it('classifies files as object-summary and folder markers as folder-summary', async () => {
    seedFolder('', 'notes');
    seedFile('notes', 'a.md', 'x');
    seedFile('', 'top.md', 'y');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    const byKey = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(byKey).toEqual({ notes: 'folder-summary', top: 'object-summary' });
  });

  it('reports a missing folder as a recoverable NotFoundError', async () => {
    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('does/not/exist', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data).toEqual([]);
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });
});

describe('D1StorageRepository extension probe', () => {
  it('finds an existing file by extension-free key in a single LIKE query', async () => {
    seedFile('', 'hello.md', 'found');

    const repo = makeRepo();
    const fetched = await LaikaTask.runPromise(repo.getObject('hello'));
    expect(fetched.content).toEqual({ body: 'found' });
    expect(fetched.metadata?.extension).toBe('md');
  });
});
