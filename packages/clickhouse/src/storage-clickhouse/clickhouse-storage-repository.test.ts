import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClickHouseDataSource, parseNdjson, serializeNdjson } from './clickhouse-datasource.js';
import { ClickHouseStorageRepository } from './clickhouse-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory ClickHouse mock.
//
// Honors the actual ClickHouse wire shape:
//
//   POST /?database=cms&query=SELECT...FORMAT JSONEachRow      (empty body)
//   POST /?database=cms&query=INSERT INTO t FORMAT JSONEachRow (NDJSON body)
//   POST /?database=cms&query=DELETE FROM t WHERE ...          (empty body)
//
// SQL is dispatched by fingerprint after URL-decoding from the query
// parameter; NDJSON bodies are parsed via parseNdjson.
// ---------------------------------------------------------------------------

const API = 'http://clickhouse.test:8123';
const DATABASE = 'cms';
const USER = 'cms_user';
const PASS = 'cms_pass';

interface Row {
  path: string;
  parent: string;
  name: string;
  type: 'file' | 'folder';
  extension: string;
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

let rows: Map<string, Row[]>; // path → array of versions (highest-version first on read with FINAL)
let insertRowCount: number;
let lastQuery: string | null = null;
let lastInsertBodyLines: number = 0;
let deleteCount: number = 0;

const upsertRow = (row: Row): void => {
  const versions = rows.get(row.path) ?? [];
  versions.push(row);
  rows.set(row.path, versions);
};

/** Apply FINAL semantics — return the row with the highest version per path. */
const finalRows = (): Row[] => {
  const out: Row[] = [];
  for (const versions of rows.values()) {
    if (versions.length === 0) continue;
    const latest = [...versions].sort((a, b) => b.version - a.version)[0]!;
    out.push(latest);
  }
  return out;
};

// ---- ClickHouse parameter substitution ----------------------------------
// {paramName:Type} placeholders are resolved from `param_<name>` URL params.
// Values are stored URL-decoded.

const substituteParams = (sql: string, params: Record<string, string>): string => {
  return sql.replace(/\{(\w+):(\w+(?:\([^)]+\))?)\}/g, (_, name) => {
    const v = params[name as string];
    if (v === undefined) return `{${name}:UNBOUND}`;
    // Strings need quoting + escaping.
    return `'${v.replace(/'/g, "\\'")}'`;
  });
};

const norm = (s: string): string =>
  // The data source always appends `FORMAT JSONEachRow` to SELECTs; strip it
  // here so the per-query fingerprint regexes don't need to match the suffix.
  s.replace(/\s+/g, ' ').trim().replace(/\s+FORMAT\s+JSONEachRow$/i, '');

// ---- SQL dispatcher ------------------------------------------------------

const evalSelect = (sql: string): Row[] | { count: number } => {
  const q = norm(sql);

  // count() aggregations
  let m = q.match(/^SELECT count\(\) AS c FROM \w+ FINAL$/);
  if (m) return { count: finalRows().length };

  m = q.match(/^SELECT count\(\) AS c FROM \w+ FINAL WHERE parent = '([^']*)'$/);
  if (m) return { count: finalRows().filter(r => r.parent === m![1]).length };

  // findFileRow: SELECT … FROM <t> FINAL WHERE type = 'file' AND parent = '…' AND name = '…' LIMIT 1
  m = q.match(/^SELECT .+ FROM \w+ FINAL WHERE type = 'file' AND parent = '([^']*)' AND name = '([^']*)' LIMIT 1$/);
  if (m) {
    const [, parent, name] = m;
    const f = finalRows().filter(r => r.type === 'file' && r.parent === parent && r.name === name);
    return f.slice(0, 1);
  }

  // folder existence: SELECT * FROM … FINAL WHERE type = 'folder' AND path = '…' LIMIT 1
  m = q.match(/^SELECT \* FROM \w+ FINAL WHERE type = 'folder' AND path = '([^']*)' LIMIT 1$/);
  if (m) {
    const path = m[1]!;
    return finalRows().filter(r => r.type === 'folder' && r.path === path).slice(0, 1);
  }

  // listAtomSummaries: SELECT … FROM … FINAL WHERE parent = '…'
  m = q.match(/^SELECT .+ FROM \w+ FINAL WHERE parent = '([^']*)'$/);
  if (m) {
    return finalRows().filter(r => r.parent === m![1]);
  }

  throw new Error(`mock: unrecognised SELECT: ${q.slice(0, 200)}`);
};

const evalDelete = (sql: string): void => {
  const q = norm(sql);
  // DELETE FROM <t> WHERE type = 'file' AND path IN ('a', 'b', 'c') SETTINGS mutations_sync = 1
  const m = q.match(/^DELETE FROM \w+ WHERE type = 'file' AND path IN \(([^)]+)\) SETTINGS mutations_sync = 1$/);
  if (!m) throw new Error(`mock: unrecognised DELETE: ${q.slice(0, 200)}`);
  // Parse the IN-list — values are 'a', 'b', 'c' (single-quoted, escaped).
  const paths: string[] = [];
  const tupleSrc = m[1]!;
  // Naive but sufficient: split on `,` outside quoted strings.
  let pos = 0;
  while (pos < tupleSrc.length) {
    while (pos < tupleSrc.length && /\s/.test(tupleSrc[pos]!)) pos += 1;
    if (tupleSrc[pos] === "'") {
      pos += 1;
      let value = '';
      while (pos < tupleSrc.length && tupleSrc[pos] !== "'") {
        if (tupleSrc[pos] === '\\') {
          value += tupleSrc[pos + 1];
          pos += 2;
        } else {
          value += tupleSrc[pos];
          pos += 1;
        }
      }
      paths.push(value);
      pos += 1;
    }
    while (pos < tupleSrc.length && tupleSrc[pos] !== "'") pos += 1;
  }
  for (const p of paths) rows.delete(p);
  deleteCount += 1;
};

// ---- Mock fetch ----------------------------------------------------------

const expectedAuth = `Basic ${btoa(`${USER}:${PASS}`)}`;

const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  if (!url.startsWith(API)) return new Response('not found', { status: 404 });
  const u = new URL(url);
  if (u.pathname !== '/' || (init?.method ?? 'GET').toUpperCase() !== 'POST') {
    return new Response('not found', { status: 404 });
  }
  const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
  if (auth !== expectedAuth) return new Response('Unauthorized', { status: 401 });
  if (u.searchParams.get('database') !== DATABASE) {
    return new Response('Bad request: wrong database', { status: 400 });
  }

  const rawSql = u.searchParams.get('query');
  if (!rawSql) return new Response('Bad request: missing query', { status: 400 });

  // Substitute `{param:Type}` placeholders from `param_<name>` query params.
  const params: Record<string, string> = {};
  for (const [k, v] of u.searchParams.entries()) {
    if (k.startsWith('param_')) params[k.slice(6)] = v;
  }
  const sql = substituteParams(rawSql, params);
  lastQuery = sql;

  const body = init?.body as string ?? '';

  // INSERT — body is NDJSON.
  let m = sql.match(/^INSERT INTO (\w+) FORMAT JSONEachRow$/);
  if (m) {
    const inserted = parseNdjson<Row>(body);
    lastInsertBodyLines = inserted.length;
    insertRowCount += inserted.length;
    for (const row of inserted) {
      upsertRow({
        path: String(row.path),
        parent: String(row.parent),
        name: String(row.name),
        type: row.type === 'folder' ? 'folder' : 'file',
        extension: String(row.extension ?? ''),
        content: String(row.content ?? ''),
        version: Number(row.version ?? Date.now()),
        createdAt: String(row.createdAt ?? new Date().toISOString()),
        updatedAt: String(row.updatedAt ?? new Date().toISOString()),
      });
    }
    return new Response('', { status: 200 });
  }

  // SELECT
  if (/^SELECT/i.test(sql)) {
    try {
      const result = evalSelect(sql);
      // Strip the trailing `FORMAT JSONEachRow` for evaluation purposes —
      // the result format is always NDJSON regardless.
      if ('count' in result) {
        return new Response(JSON.stringify({ c: result.count }) + '\n', {
          status: 200,
          headers: { 'content-type': 'application/x-ndjson' },
        });
      }
      return new Response(serializeNdjson(result as unknown as Record<string, unknown>[]) + '\n', {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      });
    } catch (err) {
      return new Response((err as Error).message, { status: 400 });
    }
  }

  // DELETE
  if (/^DELETE/i.test(sql)) {
    try {
      evalDelete(sql);
      return new Response('', { status: 200 });
    } catch (err) {
      return new Response((err as Error).message, { status: 400 });
    }
  }

  return new Response(`mock: unsupported SQL: ${sql.slice(0, 100)}`, { status: 400 });
};

// ---------------------------------------------------------------------------
// Serializer registry
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

const makeRepo = (fetchImpl: typeof fetch = mockFetch): ClickHouseStorageRepository => {
  const ds = new ClickHouseDataSource({
    url: API,
    database: DATABASE,
    auth: { basic: { username: USER, password: PASS } },
    fetch: fetchImpl,
  });
  return new ClickHouseStorageRepository({
    dataSource: ds,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'md',
  });
};

beforeEach(() => {
  rows = new Map();
  insertRowCount = 0;
  lastQuery = null;
  lastInsertBodyLines = 0;
  deleteCount = 0;
});

afterEach(() => {
  rows.clear();
});

// ---------------------------------------------------------------------------
// NDJSON helper unit tests
// ---------------------------------------------------------------------------

describe('parseNdjson / serializeNdjson', () => {
  it('round-trips a list of objects through newline-delimited JSON', () => {
    const input = [{ a: 1 }, { b: 'two' }, { c: null }];
    const text = serializeNdjson(input as Record<string, unknown>[]);
    expect(text).toBe('{"a":1}\n{"b":"two"}\n{"c":null}');
    expect(parseNdjson(text)).toEqual(input);
  });

  it('tolerates empty lines and trailing newlines', () => {
    expect(parseNdjson('{"a":1}\n\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseNdjson('')).toEqual([]);
    expect(parseNdjson('\n\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Repository tests
// ---------------------------------------------------------------------------

describe('ClickHouseStorageRepository', () => {
  it('createObject + getObject round-trip uses NDJSON-streaming INSERT', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('md');
    // revisionId surfaces the row's monotonic version (a Unix-ms timestamp).
    expect(created.metadata?.revisionId).toMatch(/^\d+$/);

    // The row was inserted with the correct shape.
    const stored = rows.get('notes/hello.md')?.[0];
    expect(stored).toMatchObject({
      path: 'notes/hello.md',
      parent: 'notes',
      name: 'hello',
      type: 'file',
      extension: 'md',
      content: 'hi',
    });

    // Round-trip read.
    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ body: 'hi' });
  });

  it('INSERT body is NDJSON (one JSON object per line)', async () => {
    // Sniff the body of the INSERT request.
    let lastBody: string | null = null;
    const sniff: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.includes('INSERT')) lastBody = init?.body as string;
      return mockFetch(input, init);
    };
    const repo = makeRepo(sniff);
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    // Body is a JSON object — no array brackets, no top-level wrapping.
    expect(lastBody).toBeTruthy();
    expect(lastBody![0]).toBe('{');
    expect(lastBody!.endsWith('}')).toBe(true);
    expect(() => JSON.parse(lastBody!)).not.toThrow();
    expect(parseNdjson(lastBody!)).toHaveLength(1);
  });

  it('SQL travels in the ?query= URL parameter, not the body', async () => {
    // Sniff URL vs body shape for SELECT.
    let selectUrl: string | null = null;
    let selectBody: string | null = null;
    const sniff: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      // Catch SELECTs by their query content.
      const u = new URL(url);
      const q = u.searchParams.get('query') ?? '';
      if (q.startsWith('SELECT')) {
        selectUrl = url;
        selectBody = init?.body as string;
      }
      return mockFetch(input, init);
    };
    const repo = makeRepo(sniff);
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await LaikaTask.runPromise(repo.getObject('notes/x'));
    // *The* load-bearing wire-shape distinction:
    expect(selectUrl).toMatch(/\?database=cms&query=/);
    expect(selectBody).toBe(''); // body is empty for SELECTs
  });

  it('SELECTs use the FINAL modifier (ReplacingMergeTree consistency)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await LaikaTask.runPromise(repo.getObject('notes/x'));
    expect(lastQuery).toContain('FINAL');
  });

  it('updateObject re-inserts with a new version (ReplacingMergeTree dedup)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    const versionsBefore = rows.get('notes/x.md')?.length ?? 0;
    expect(versionsBefore).toBe(1);

    // Wait one ms so the version timestamp diverges (Date.now()).
    await new Promise(r => setTimeout(r, 2));
    await LaikaTask.runPromise(
      repo.updateObject({ key: 'notes/x', content: { body: 'b' } }),
    );
    // Two physical rows exist for the same path — ReplacingMergeTree
    // will dedup on next background merge; FINAL reads see only the
    // higher version.
    const versionsAfter = rows.get('notes/x.md')?.length ?? 0;
    expect(versionsAfter).toBe(2);

    // Read sees the latest content thanks to FINAL.
    const fetched = await LaikaTask.runPromise(repo.getObject('notes/x'));
    expect(fetched.content).toEqual({ body: 'b' });
  });

  it('createObject rejects duplicates via findFileRow probe (application-level)', async () => {
    // Note: ClickHouse's ReplacingMergeTree doesn't reject duplicates at
    // the storage level — it dedups silently. So we enforce uniqueness
    // at the application layer via the resolveFile probe.
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

  it('removeAtoms uses lightweight DELETE with IN-list + SETTINGS mutations_sync = 1', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }
    deleteCount = 0;
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });
    expect(removed.data.sort()).toEqual(['notes/a', 'notes/b', 'notes/c']);
    // Single DELETE statement.
    expect(deleteCount).toBe(1);
    // Each verify the wire shape used the SYNC settings clause.
    expect(lastQuery).toContain('SETTINGS mutations_sync = 1');
    // And path IN-list.
    expect(lastQuery).toMatch(/path IN \(/);
    expect(rows.size).toBe(0);
  });

  it('removeAtoms reports missing keys as skipped', async () => {
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

  it('listAtomSummaries dispatches a single SELECT FINAL WHERE parent', async () => {
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

  it('listAtomSummaries orders results naturally', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '10', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '2', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '1', content: { body: 'c' } }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: PAGE }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10']);
  });

  it('createFolder is idempotent (re-inserts dedup on FINAL read)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    await new Promise(r => setTimeout(r, 2));
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    // Two physical rows, one logical row after FINAL.
    const folder = await LaikaTask.runPromise(repo.getFolder('twice'));
    expect(folder.type).toBe('folder');
  });

  it('getFolder fails for a missing folder path', async () => {
    const repo = makeRepo();
    await expect(LaikaTask.runPromise(repo.getFolder('nowhere'))).rejects.toThrow(/not found|empty/i);
  });

  it('table name is validated against SQL-injection patterns', async () => {
    const ds = new ClickHouseDataSource({
      url: API, database: DATABASE,
      auth: { basic: { username: USER, password: PASS } }, fetch: mockFetch,
    });
    expect(() => new ClickHouseStorageRepository({
      dataSource: ds,
      tableName: "evil; DROP TABLE laika_storage --",
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'md',
    })).toThrow(/Invalid SQL identifier/);
  });
});

// Reference unused symbols.
void insertRowCount;
void lastInsertBodyLines;
