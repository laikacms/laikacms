import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ArangoCursorResponse, ArangoDataSource, type ArangoDocMeta } from './arango-datasource.js';
import { ArangoStorageRepository, keyToPath, pathToKey } from './arango-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory ArangoDB HTTP mock.
//
// Endpoints honoured:
//
//   POST /_db/{db}/_api/cursor                                  → AQL query
//   POST /_db/{db}/_api/document/{collection}?overwriteMode=…   → upsert
//   GET  /_db/{db}/_api/document/{collection}/{key}             → fetch by _key
//
// The AQL dispatcher fingerprints each query against the exact shapes
// the repository emits.
// ---------------------------------------------------------------------------

const API = 'https://arangodb.test:8529';
const DATABASE = 'cms';
const USER = 'root';
const PASS = 'password';

const expectedAuth = `Basic ${btoa(`${USER}:${PASS}`)}`;

interface StoredDoc {
  _key: string;
  _id: string;
  _rev: string;
  type: 'file' | 'folder';
  path: string;
  parent: string;
  name: string;
  extension?: string;
  content?: string;
  createdAt: string;
  updatedAt: string;
}

let collections: Map<string, Map<string, StoredDoc>>;
let revCounter: number;
let aqlCallCount: number;
let lastAql: string | null = null;
let lastAqlBindVars: Record<string, unknown> | null = null;
let allAql: string[] = [];
let removeAqlCount: number;
let removeAqlPaths: string[] | null = null;

const nextRev = (): string => `_${(++revCounter).toString(36)}`;

const ensureCollection = (name: string): Map<string, StoredDoc> => {
  let coll = collections.get(name);
  if (!coll) {
    coll = new Map();
    collections.set(name, coll);
  }
  return coll;
};

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

// ---- AQL dispatcher ------------------------------------------------------

const evalAql = (query: string, bindVars: Record<string, unknown>): unknown[] => {
  const q = norm(query);
  aqlCallCount += 1;
  lastAql = q;
  lastAqlBindVars = bindVars;
  allAql.push(q);

  // ---- findFileRecord: SELECT-LIMIT-RETURN
  let m = q.match(
    /^FOR doc IN (\w+) FILTER doc\.type == @type AND doc\.parent == @parent AND doc\.name == @name LIMIT 1 RETURN doc$/,
  );
  if (m) {
    const coll = collections.get(m[1]!);
    if (!coll) return [];
    const found = [...coll.values()].find(
      d =>
        d.type === bindVars['type']
        && d.parent === bindVars['parent']
        && d.name === bindVars['name'],
    );
    return found ? [found] : [];
  }

  // ---- Probe: any doc
  m = q.match(/^FOR doc IN (\w+) LIMIT 1 RETURN doc$/);
  if (m) {
    const coll = collections.get(m[1]!);
    return coll && coll.size > 0 ? [{ probe: true }] : [];
  }

  // ---- Probe: any descendant
  m = q.match(/^FOR doc IN (\w+) FILTER doc\.parent == @parent LIMIT 1 RETURN doc$/);
  if (m) {
    const coll = collections.get(m[1]!);
    if (!coll) return [];
    const found = [...coll.values()].find(d => d.parent === bindVars['parent']);
    return found ? [found] : [];
  }

  // ---- INSERT @doc INTO collection RETURN NEW
  m = q.match(/^INSERT @doc INTO (\w+) RETURN NEW$/);
  if (m) {
    const collName = m[1]!;
    const doc = bindVars['doc'] as StoredDoc;
    const coll = ensureCollection(collName);
    if (coll.has(doc._key)) {
      // Simulate ArangoDB's ERROR_ARANGO_UNIQUE_CONSTRAINT_VIOLATED (1210).
      throw Object.assign(new Error(`unique constraint violated for ${doc._key}`), {
        status: 409,
        errorNum: 1210,
      });
    }
    const stored: StoredDoc = {
      ...doc,
      _id: `${collName}/${doc._key}`,
      _rev: nextRev(),
    };
    coll.set(doc._key, stored);
    return [stored];
  }

  // ---- UPDATE @key WITH @changes IN collection RETURN NEW
  m = q.match(/^UPDATE @key WITH @changes IN (\w+) RETURN NEW$/);
  if (m) {
    const coll = collections.get(m[1]!);
    if (!coll) return [];
    const key = String(bindVars['key']);
    const existing = coll.get(key);
    if (!existing) return [];
    const updated: StoredDoc = {
      ...existing,
      ...(bindVars['changes'] as Partial<StoredDoc>),
      _rev: nextRev(),
    };
    coll.set(key, updated);
    return [updated];
  }

  // ---- Bulk delete (the load-bearing one):
  //   FOR doc IN <coll>
  //     FILTER doc.path IN @paths
  //     REMOVE doc IN <coll>
  //     RETURN OLD._key
  m = q.match(/^FOR doc IN (\w+) FILTER doc\.path IN @paths REMOVE doc IN \w+ RETURN OLD\._key$/);
  if (m) {
    removeAqlCount += 1;
    const coll = collections.get(m[1]!);
    if (!coll) return [];
    const paths = (bindVars['paths'] as string[]) ?? [];
    removeAqlPaths = paths;
    const deletedKeys: string[] = [];
    for (const [key, doc] of coll) {
      if (paths.includes(doc.path)) {
        coll.delete(key);
        deletedKeys.push(key);
      }
    }
    return deletedKeys;
  }

  // ---- List children: FOR doc IN <coll> FILTER doc.parent == @parent RETURN doc
  m = q.match(/^FOR doc IN (\w+) FILTER doc\.parent == @parent RETURN doc$/);
  if (m) {
    const coll = collections.get(m[1]!);
    if (!coll) return [];
    return [...coll.values()].filter(d => d.parent === bindVars['parent']);
  }

  throw new Error(`mock: unrecognised AQL: ${q.slice(0, 200)}`);
};

// ---- Mock fetch ----------------------------------------------------------

const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  if (!url.startsWith(API)) return new Response('not found', { status: 404 });
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = (init?.headers as Record<string, string> | undefined) ?? {};
  if (headers['Authorization'] !== expectedAuth) {
    return new Response(JSON.stringify({ errorMessage: 'unauthorized' }), { status: 401 });
  }
  const u = new URL(url);
  const path = u.pathname;

  // ---- POST /_db/{db}/_api/cursor ----
  if (method === 'POST' && path === `/_db/${DATABASE}/_api/cursor`) {
    const body = JSON.parse(init?.body as string) as { query: string, bindVars?: Record<string, unknown> };
    try {
      const result = evalAql(body.query, body.bindVars ?? {});
      const envelope: ArangoCursorResponse<unknown> = {
        result,
        hasMore: false,
        error: false,
        code: 200,
      };
      return new Response(JSON.stringify(envelope), { status: 201 });
    } catch (err) {
      const e = err as Error & { status?: number, errorNum?: number };
      return new Response(
        JSON.stringify({
          errorMessage: e.message,
          errorNum: e.errorNum ?? 1,
          error: true,
          code: e.status ?? 500,
        }),
        { status: e.status ?? 500 },
      );
    }
  }

  // ---- GET /_db/{db}/_api/document/{coll}/{key} ----
  let m = path.match(/^\/_db\/[^/]+\/_api\/document\/([^/]+)\/([^/]+)$/);
  if (m && method === 'GET') {
    const coll = collections.get(decodeURIComponent(m[1]!));
    if (!coll) return new Response(JSON.stringify({ errorMessage: 'not found' }), { status: 404 });
    const doc = coll.get(decodeURIComponent(m[2]!));
    if (!doc) return new Response(JSON.stringify({ errorMessage: 'not found' }), { status: 404 });
    return new Response(JSON.stringify(doc), { status: 200 });
  }

  // ---- POST /_db/{db}/_api/document/{coll}?overwriteMode=… ----
  m = path.match(/^\/_db\/[^/]+\/_api\/document\/([^/]+)$/);
  if (m && method === 'POST') {
    const collName = decodeURIComponent(m[1]!);
    const overwrite = u.searchParams.get('overwriteMode') ?? 'conflict';
    const body = JSON.parse(init?.body as string) as StoredDoc;
    const coll = ensureCollection(collName);
    const existing = coll.get(body._key);
    if (existing && overwrite === 'conflict') {
      return new Response(
        JSON.stringify({
          errorMessage: 'unique constraint violated',
          errorNum: 1210,
          error: true,
        }),
        { status: 409 },
      );
    }
    if (existing && overwrite === 'ignore') {
      return new Response(
        JSON.stringify({
          ...existing,
          new: existing,
        }),
        { status: 200 },
      );
    }
    const stored: StoredDoc = {
      ...body,
      _id: `${collName}/${body._key}`,
      _rev: nextRev(),
    };
    coll.set(body._key, stored);
    return new Response(JSON.stringify({ ...stored, new: stored }), { status: 201 });
  }

  return new Response('not found', { status: 404 });
};

// ---------------------------------------------------------------------------
// Serializer registry
// ---------------------------------------------------------------------------

const serializerRegistry = {
  md: {
    format: { mediaType: 'text/markdown' } as never,
    serializeDocumentFileContents: async (content: unknown) => String((content as { body?: string }).body ?? ''),
    deserializeDocumentFileContents: async (raw: string) => ({ body: raw }),
  },
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw),
  },
};

const PAGE = { offset: 0, limit: 100 };

const makeRepo = (): ArangoStorageRepository => {
  const ds = new ArangoDataSource({
    url: API,
    database: DATABASE,
    auth: { basic: { username: USER, password: PASS } },
    fetch: mockFetch,
  });
  return new ArangoStorageRepository({
    dataSource: ds,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'md',
  });
};

beforeEach(() => {
  collections = new Map();
  revCounter = 0;
  aqlCallCount = 0;
  lastAql = null;
  lastAqlBindVars = null;
  allAql = [];
  removeAqlCount = 0;
  removeAqlPaths = null;
});

afterEach(() => {
  collections.clear();
});

// ---------------------------------------------------------------------------
// Key-encoding helper unit tests
// ---------------------------------------------------------------------------

describe('pathToKey / keyToPath', () => {
  it('encodes slashes as `--` (Arango _key reserved-char workaround)', () => {
    expect(pathToKey('notes/hello.md')).toBe('notes--hello.md');
    expect(pathToKey('a/b/c/deep.md')).toBe('a--b--c--deep.md');
    expect(pathToKey('/leading/slash/')).toBe('leading--slash');
  });

  it('round-trips through keyToPath', () => {
    expect(keyToPath('notes--hello.md')).toBe('notes/hello.md');
    expect(keyToPath('a--b--c--deep.md')).toBe('a/b/c/deep.md');
  });
});

// ---------------------------------------------------------------------------
// Repository tests
// ---------------------------------------------------------------------------

describe('ArangoStorageRepository', () => {
  it('createObject + getObject round-trip stores a doc with _key, type, parent, name', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('md');
    // `_rev` surfaces as revisionId — server-managed token.
    expect(created.metadata?.revisionId).toMatch(/^_/);

    // Verify the on-wire document — including the `--`-encoded `_key`.
    const stored = collections.get('laika_files')?.get('notes--hello.md');
    expect(stored).toMatchObject({
      _key: 'notes--hello.md',
      _id: 'laika_files/notes--hello.md',
      type: 'file',
      path: 'notes/hello.md',
      parent: 'notes',
      name: 'hello',
      extension: 'md',
      content: 'hi',
    });
    expect(stored?._rev).toMatch(/^_/);

    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ body: 'hi' });
  });

  it('reads use AQL FOR/FILTER/RETURN syntax', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    lastAql = null;
    await LaikaTask.runPromise(repo.getObject('notes/x'));
    expect(lastAql).toContain('FOR doc IN laika_files');
    expect(lastAql).toContain('FILTER doc.type == @type AND doc.parent == @parent AND doc.name == @name');
    expect(lastAql).toContain('RETURN doc');
  });

  it('bind variables use `@name` syntax (not `:`, `$`, or `?`)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    lastAql = null;
    lastAqlBindVars = null;
    await LaikaTask.runPromise(repo.getObject('notes/x'));
    expect(lastAql).toMatch(/@type/);
    expect(lastAql).toMatch(/@parent/);
    expect(lastAql).toMatch(/@name/);
    // bindVars on the wire match the `@name` placeholders.
    expect(lastAqlBindVars).toMatchObject({ type: 'file', parent: 'notes', name: 'x' });
  });

  it('database appears in the URL path on every request', async () => {
    let lastUrl: string | null = null;
    const sniff: typeof fetch = async (input, init) => {
      lastUrl = typeof input === 'string' ? input : (input as URL).toString();
      return mockFetch(input, init);
    };
    const ds = new ArangoDataSource({
      url: API,
      database: DATABASE,
      auth: { basic: { username: USER, password: PASS } },
      fetch: sniff,
    });
    const repo = new ArangoStorageRepository({
      dataSource: ds,
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'md',
    });
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    // *The* distinctive URL convention — database lives in the path.
    expect(lastUrl).toMatch(/\/_db\/cms\/_api\//);
  });

  it('createObject rejects duplicates via the resolveFile probe', async () => {
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

  it('updateObject uses AQL `UPDATE @key WITH @changes` shape', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    allAql = [];
    await LaikaTask.runPromise(
      repo.updateObject({ key: 'notes/x', content: { body: 'b' } }),
    );
    // updateObject re-reads via getObject afterwards, so the UPDATE is not the
    // last query — assert it appears among the dispatched AQL statements.
    expect(allAql.some(q => /UPDATE @key WITH @changes IN laika_files/.test(q))).toBe(true);
    expect(collections.get('laika_files')?.get('notes--x.md')?.content).toBe('b');
  });

  it('updateObject advances _rev (server-managed OCC token)', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'notes/x', content: { body: 'b' } }),
    );
    expect(updated.metadata?.revisionId).not.toBe(created.metadata?.revisionId);
  });

  it('removeAtoms ships as ONE AQL `FOR ... REMOVE` query with @paths bound', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }
    removeAqlCount = 0;
    removeAqlPaths = null;
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });
    expect(removed.data.sort()).toEqual(['notes/a', 'notes/b', 'notes/c']);
    // *The* distinctive trait — exactly ONE AQL FOR/REMOVE query, with
    // all three paths bound as a single `@paths` array.
    expect(removeAqlCount).toBe(1);
    expect(removeAqlPaths).toEqual(['notes/a.md', 'notes/b.md', 'notes/c.md']);
    expect(collections.get('laika_files')?.size ?? 0).toBe(0);
  });

  it('the bulk-delete AQL uses `FOR ... FILTER ... IN @paths REMOVE ... RETURN OLD._key`', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }),
    );
    lastAql = null;
    await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes/a']));
    expect(lastAql).toContain('FOR doc IN laika_files');
    expect(lastAql).toContain('FILTER doc.path IN @paths');
    expect(lastAql).toContain('REMOVE doc IN laika_files');
    expect(lastAql).toContain('RETURN OLD._key');
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

  it('listAtomSummaries dispatches two AQL queries (files + folders)', async () => {
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

  it('createFolder creates a folder document via REST upsert (overwriteMode=ignore)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'empty' }));
    expect(collections.get('laika_folders')?.has('empty')).toBe(true);
    const folder = await LaikaTask.runPromise(repo.getFolder('empty'));
    expect(folder.type).toBe('folder');
  });

  it('createFolder is idempotent', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    expect(collections.get('laika_folders')?.size).toBe(1);
  });

  it('getFolder fails for a missing path', async () => {
    const repo = makeRepo();
    await expect(LaikaTask.runPromise(repo.getFolder('nowhere'))).rejects.toThrow(/not found|empty/i);
  });

  it('collection-name validation rejects injection patterns', async () => {
    const ds = new ArangoDataSource({
      url: API,
      database: DATABASE,
      auth: { basic: { username: USER, password: PASS } },
      fetch: mockFetch,
    });
    expect(() =>
      new ArangoStorageRepository({
        dataSource: ds,
        fileCollection: 'evil; DROP COLLECTION',
        serializerRegistry: serializerRegistry as never,
        defaultFileExtension: 'md',
      })
    ).toThrow(/Invalid ArangoDB collection name/);
  });
});

// Reference unused symbols.
void aqlCallCount;
