import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SurrealDbDataSource, type SurqlStatementResult } from './surrealdb-datasource.js';
import { SurrealDbStorageRepository } from './surrealdb-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory SurrealDB mock.
//
// Handles only the SurQL fragments the repository actually emits, dispatched
// by fingerprint:
//
//   BEGIN TRANSACTION
//   COMMIT TRANSACTION
//   CREATE  type::thing($table, $path) CONTENT $value
//   UPSERT  type::thing($table, $path) CONTENT $value
//   UPDATE  type::thing($table, $path) MERGE $merge
//   DELETE  type::thing($table, $path)
//   SELECT  ... FROM <table>  [WHERE parent = $parent | WHERE path = $path | WHERE type = ... AND parent = ... AND name = ... LIMIT 1]
//   SELECT  id FROM <table> LIMIT 1
//
// Per-statement results are returned as `{status, time, result}` envelopes,
// matching the wire shape of `POST /sql`.
// ---------------------------------------------------------------------------

const API = 'http://surreal.test:8000';
const NS = 'cms_ns';
const DB = 'cms_db';
const TOKEN = 'surreal_test_jwt';

interface Record_ {
  id: string;        // `<table>:<path>`
  path: string;
  parent: string;
  name: string;
  extension?: string;
  content?: string;
  type: 'file' | 'folder';
  createdAt: string;
  updatedAt: string;
}

let store: Map<string, Record_>; // keyed by full record id `<table>:<path>`
let sqlPostCount: number;
let transactionStatementCount: number; // number of CREATE/UPDATE/DELETE inside transactions
let lastSqlBody: string | null = null;
let receivedNsHeader: string | null = null;
let receivedDbHeader: string | null = null;
let receivedAuthHeader: string | null = null;

const makeId = (table: string, path: string): string => `${table}:${path}`;

// ---- SurQL evaluator -----------------------------------------------------

interface ExecuteCtx {
  vars: Record<string, unknown>;
  insideTransaction: boolean;
}

const result = (status: 'OK' | 'ERR', value: unknown): SurqlStatementResult => ({
  status,
  time: '1ms',
  result: value,
});

const evalStatement = (stmt: string, ctx: ExecuteCtx): SurqlStatementResult => {
  const trimmed = stmt.replace(/\s+/g, ' ').trim();
  if (trimmed === '') return result('OK', null);

  // ---- Transaction control ----------------------------------------------
  if (/^BEGIN TRANSACTION$/i.test(trimmed)) return result('OK', null);
  if (/^COMMIT TRANSACTION$/i.test(trimmed)) return result('OK', null);

  // ---- CREATE type::thing($table, $path) CONTENT $value -----------------
  let m = trimmed.match(/^CREATE type::thing\(\$(\w+), \$(\w+)\) CONTENT \$(\w+)$/i);
  if (m) {
    const tableVar = m[1]!, pathVar = m[2]!, valueVar = m[3]!;
    const table = String(ctx.vars[tableVar]);
    const path = String(ctx.vars[pathVar]);
    const value = ctx.vars[valueVar] as Omit<Record_, 'id'>;
    const id = makeId(table, path);
    if (store.has(id)) {
      return result('ERR', `There was a problem with the database: Database record already exists for ${id} (UNIQUE constraint)`);
    }
    store.set(id, { ...value, id });
    if (ctx.insideTransaction) transactionStatementCount += 1;
    return result('OK', [{ ...value, id }]);
  }

  // ---- UPSERT type::thing($table, $path) CONTENT $value ----------------
  m = trimmed.match(/^UPSERT type::thing\(\$(\w+), \$(\w+)\) CONTENT \$(\w+)$/i);
  if (m) {
    const table = String(ctx.vars[m[1]!]);
    const path = String(ctx.vars[m[2]!]);
    const value = ctx.vars[m[3]!] as Omit<Record_, 'id'>;
    const id = makeId(table, path);
    store.set(id, { ...value, id });
    if (ctx.insideTransaction) transactionStatementCount += 1;
    return result('OK', [{ ...value, id }]);
  }

  // ---- UPDATE type::thing($table, $path) MERGE $merge -------------------
  m = trimmed.match(/^UPDATE type::thing\(\$(\w+), \$(\w+)\) MERGE \$(\w+)$/i);
  if (m) {
    const table = String(ctx.vars[m[1]!]);
    const path = String(ctx.vars[m[2]!]);
    const merge = ctx.vars[m[3]!] as Partial<Record_>;
    const id = makeId(table, path);
    const existing = store.get(id);
    if (!existing) {
      return result('OK', []);
    }
    const merged = { ...existing, ...merge };
    store.set(id, merged);
    if (ctx.insideTransaction) transactionStatementCount += 1;
    return result('OK', [merged]);
  }

  // ---- DELETE type::thing($table, $path) -------------------------------
  m = trimmed.match(/^DELETE type::thing\(\$(\w+), \$(\w+)\)$/i);
  if (m) {
    const table = String(ctx.vars[m[1]!]);
    const path = String(ctx.vars[m[2]!]);
    const id = makeId(table, path);
    const had = store.delete(id);
    if (ctx.insideTransaction) transactionStatementCount += 1;
    return result('OK', had ? [{ id }] : []);
  }

  // ---- SELECT * FROM <table> WHERE type = "file" AND parent = $... AND name = $... LIMIT 1
  m = trimmed.match(/^SELECT \* FROM (\w+) WHERE type = "file" AND parent = \$(\w+) AND name = \$(\w+) LIMIT 1$/i);
  if (m) {
    const table = m[1]!;
    const parent = String(ctx.vars[m[2]!]);
    const name = String(ctx.vars[m[3]!]);
    const matched = [...store.values()].filter(
      r => r.id.startsWith(`${table}:`) && r.type === 'file' && r.parent === parent && r.name === name,
    );
    return result('OK', matched.slice(0, 1));
  }

  // ---- SELECT * FROM <table> WHERE parent = $parent --------------------
  m = trimmed.match(/^SELECT \* FROM (\w+) WHERE parent = \$(\w+)$/i);
  if (m) {
    const table = m[1]!;
    const parent = String(ctx.vars[m[2]!]);
    const matched = [...store.values()].filter(
      r => r.id.startsWith(`${table}:`) && r.parent === parent,
    );
    return result('OK', matched);
  }

  // ---- SELECT id FROM <table> WHERE path = $path LIMIT 1 ---------------
  m = trimmed.match(/^SELECT id FROM (\w+) WHERE path = \$(\w+) LIMIT 1$/i);
  if (m) {
    const table = m[1]!;
    const path = String(ctx.vars[m[2]!]);
    const matched = [...store.values()].filter(
      r => r.id.startsWith(`${table}:`) && r.path === path,
    );
    return result('OK', matched.slice(0, 1));
  }

  // ---- SELECT id FROM <table> WHERE parent = $parent LIMIT 1 -----------
  m = trimmed.match(/^SELECT id FROM (\w+) WHERE parent = \$(\w+) LIMIT 1$/i);
  if (m) {
    const table = m[1]!;
    const parent = String(ctx.vars[m[2]!]);
    const matched = [...store.values()].filter(
      r => r.id.startsWith(`${table}:`) && r.parent === parent,
    );
    return result('OK', matched.slice(0, 1));
  }

  // ---- SELECT id FROM <table> LIMIT 1 ----------------------------------
  m = trimmed.match(/^SELECT id FROM (\w+) LIMIT 1$/i);
  if (m) {
    const table = m[1]!;
    const matched = [...store.values()].filter(r => r.id.startsWith(`${table}:`));
    return result('OK', matched.slice(0, 1));
  }

  return result('ERR', `mock: unrecognised SurQL: ${trimmed.slice(0, 100)}`);
};

// ---- Mock fetch ----------------------------------------------------------

const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  if (!url.startsWith(API)) return new Response('not found', { status: 404 });
  const u = new URL(url);
  if (u.pathname !== '/sql' || (init?.method ?? 'GET').toUpperCase() !== 'POST') {
    return new Response('not found', { status: 404 });
  }

  // Capture headers so tests can assert NS / DB / Authorization were sent.
  const h = (init?.headers ?? {}) as Record<string, string>;
  receivedNsHeader = h['NS'] ?? null;
  receivedDbHeader = h['DB'] ?? null;
  receivedAuthHeader = h['Authorization'] ?? null;
  if (receivedAuthHeader !== `Bearer ${TOKEN}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (receivedNsHeader !== NS || receivedDbHeader !== DB) {
    return new Response('Bad request: missing NS/DB', { status: 400 });
  }

  sqlPostCount += 1;
  lastSqlBody = init?.body as string;

  // Collect vars from the query string.
  const vars: Record<string, unknown> = {};
  for (const [k, v] of u.searchParams) {
    try { vars[k] = JSON.parse(v); } catch { vars[k] = v; }
  }

  const surql = init?.body as string;
  // Split on top-level semicolons.
  const stmts = surql.split(';').map(s => s.trim()).filter(s => s.length > 0);

  // Track transaction state across statements.
  let insideTxn = false;
  const results: SurqlStatementResult[] = [];
  for (const stmt of stmts) {
    const isBegin = /^BEGIN TRANSACTION$/i.test(stmt);
    const isCommit = /^COMMIT TRANSACTION$/i.test(stmt);
    const ctx = { vars, insideTransaction: insideTxn };
    results.push(evalStatement(stmt, ctx));
    if (isBegin) insideTxn = true;
    if (isCommit) insideTxn = false;
  }

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

// ---------------------------------------------------------------------------
// Serializer registry.
// ---------------------------------------------------------------------------

const serializerRegistry = {
  md: {
    format: { mediaType: 'text/markdown' } as never,
    serializeDocumentFileContents: async (content: unknown) =>
      String((content as { body?: string }).body ?? ''),
    deserializeDocumentFileContents: async (raw: string) => ({ body: raw }),
  },
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw),
  },
};

const PAGE = { offset: 0, limit: 100 };

const makeRepo = (fetchImpl: typeof fetch = mockFetch): SurrealDbStorageRepository => {
  const ds = new SurrealDbDataSource({
    url: API,
    namespace: NS,
    database: DB,
    auth: { token: TOKEN },
    fetch: fetchImpl,
  });
  return new SurrealDbStorageRepository({
    dataSource: ds,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'md',
  });
};

beforeEach(() => {
  store = new Map();
  sqlPostCount = 0;
  transactionStatementCount = 0;
  lastSqlBody = null;
  receivedNsHeader = null;
  receivedDbHeader = null;
  receivedAuthHeader = null;
});

afterEach(() => {
  store.clear();
});

describe('SurrealDbStorageRepository', () => {
  it('createObject + getObject round-trip stores a record with type:id', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('md');
    // revisionId is the SurrealDB record id — `laika_file:<path>`.
    expect(created.metadata?.revisionId).toBe('laika_file:notes/hello.md');

    // Verify the on-wire record id and stored value.
    const stored = store.get('laika_file:notes/hello.md');
    expect(stored).toMatchObject({
      id: 'laika_file:notes/hello.md',
      path: 'notes/hello.md',
      parent: 'notes',
      name: 'hello',
      extension: 'md',
      content: 'hi',
      type: 'file',
    });

    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ body: 'hi' });
  });

  it('every request carries the NS and DB headers and Bearer auth', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    // The mock fetch records the most-recent headers; verify it picked them up.
    expect(receivedNsHeader).toBe(NS);
    expect(receivedDbHeader).toBe(DB);
    expect(receivedAuthHeader).toBe(`Bearer ${TOKEN}`);
  });

  it('createObject rejects duplicates via UNIQUE constraint → EntryAlreadyExistsError', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'b' } }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('updateObject uses UPDATE MERGE — partial patch keeps unchanged fields', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    const originalCreatedAt = store.get('laika_file:notes/x.md')?.createdAt;
    await LaikaTask.runPromise(
      repo.updateObject({ key: 'notes/x', content: { body: 'b' } }),
    );
    const updated = store.get('laika_file:notes/x.md');
    expect(updated?.content).toBe('b');
    // createdAt preserved across the MERGE.
    expect(updated?.createdAt).toBe(originalCreatedAt);
  });

  it('removeAtoms ships as ONE BEGIN/COMMIT transaction with N DELETE statements', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }
    sqlPostCount = 0;
    transactionStatementCount = 0;
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });
    expect(removed.data.sort()).toEqual(['notes/a', 'notes/b', 'notes/c']);

    // The body of the LAST POST /sql is the transaction itself — verify it
    // wraps the 3 DELETEs in BEGIN/COMMIT.
    expect(lastSqlBody).toMatch(/BEGIN TRANSACTION/);
    expect(lastSqlBody).toMatch(/COMMIT TRANSACTION/);
    expect(transactionStatementCount).toBe(3);
    expect(store.size).toBe(0);
  });

  it('transaction renames vars to avoid collision between statements', async () => {
    // When two statements use $table and $path, the data source must
    // namespace them ($table_0, $path_0, $table_1, $path_1, …) so the
    // single set of query-string vars doesn't get clobbered.
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a', content: { body: 'a' } }),
    );
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'b', content: { body: 'b' } }),
    );
    await LaikaStream.runPromiseCollect(repo.removeAtoms(['a', 'b']));
    expect(lastSqlBody).toContain('$table_0');
    expect(lastSqlBody).toContain('$path_0');
    expect(lastSqlBody).toContain('$table_1');
    expect(lastSqlBody).toContain('$path_1');
    expect(store.size).toBe(0);
  });

  it('removeAtoms reports missing keys as skipped without aborting', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }),
    );
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/nope']),
    );
    expect(removed.done).toEqual({ removed: 1, skipped: 1 });
    expect(removed.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('listAtomSummaries dispatches two SELECTs and reconstructs children', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/b', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes/sub' }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('notes', { pagination: PAGE }),
    );
    const types = collected.data.reduce((acc, s) => {
      acc[s.key] = s.type;
      return acc;
    }, {} as Record<string, string>);
    expect(types).toEqual({
      'notes/a': 'object-summary',
      'notes/b': 'object-summary',
      'notes/sub': 'folder-summary',
    });
  });

  it('createFolder writes a record to the folder table; getFolder finds it', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'empty' }));
    const stored = store.get('laika_folder:empty');
    expect(stored).toMatchObject({
      id: 'laika_folder:empty',
      type: 'folder',
      path: 'empty',
      name: 'empty',
    });
    const folder = await LaikaTask.runPromise(repo.getFolder('empty'));
    expect(folder.type).toBe('folder');
  });

  it('createFolder is idempotent (UPSERT)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    expect(store.size).toBe(1);
  });

  it('getFolder recognises an implicit folder via descendants', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'x' } }),
    );
    const folder = await LaikaTask.runPromise(repo.getFolder('notes'));
    expect(folder.type).toBe('folder');
  });

  it('getFolder fails for a missing path', async () => {
    const repo = makeRepo();
    await expect(LaikaTask.runPromise(repo.getFolder('nowhere'))).rejects.toThrow(/not found/i);
  });

  it('SurQL uses type::thing() for safe id construction (sniffed)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    // Find the CREATE statement in the recent SQL traffic. lastSqlBody is
    // the LAST request — which was the SELECT for the read-back. Verify by
    // searching all POSTs.
    expect(sqlPostCount).toBeGreaterThan(0);
    // The repository must have used `type::thing(...)` at some point.
    // Easiest assertion: there's a stored record whose id is `<table>:<path>`.
    expect(store.has('laika_file:notes/hello.md')).toBe(true);
  });

  it('table name option is validated against an injection-safe regex', async () => {
    const ds = new SurrealDbDataSource({
      url: API, namespace: NS, database: DB, auth: { token: TOKEN }, fetch: mockFetch,
    });
    expect(() => new SurrealDbStorageRepository({
      dataSource: ds,
      fileTable: "evil; DROP TABLE laika_file --",
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'md',
    })).toThrow(/Invalid SQL identifier/);
  });
});
