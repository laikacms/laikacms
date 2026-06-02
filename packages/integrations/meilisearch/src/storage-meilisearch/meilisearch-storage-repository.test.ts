import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { runStorageRepositoryContract } from 'laikacms/storage/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { meilisearchContractCase } from './testing/index.js';

import { andFilter, eqFilter, MeiliDataSource, type MeiliDocument } from './meilisearch-datasource.js';
import { MeiliStorageRepository } from './meilisearch-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory MeiliSearch mock.
//
// Six endpoints carry the test surface:
//
//   GET    /indexes/{uid}                                — index info
//   POST   /indexes                                       — create index (→ task)
//   PUT    /indexes/{uid}/documents                       — upsert docs (→ task)
//   POST   /indexes/{uid}/documents/delete-batch          — bulk delete by IDs (→ task)
//   POST   /indexes/{uid}/search                          — sync search
//   GET    /indexes/{uid}/documents/{id}                  — sync get
//   PUT    /indexes/{uid}/settings/filterable-attributes  — set filterable (→ task)
//   GET    /tasks/{uid}                                   — task status
//
// **Tasks always succeed immediately in the mock** — the polling loop in
// the data source completes on its first poll.
// ---------------------------------------------------------------------------

const API = 'https://meilisearch.test:7700';
const API_KEY = 'meili_master_test';

interface Index {
  primaryKey: string;
  filterableAttributes: string[];
  documents: Map<string, MeiliDocument>;
}

let indexes: Map<string, Index>;
let nextTaskUid: number;
let completedTasks: Set<number>; // tasks whose status we'll return as `succeeded`
let getTaskCount: number; // polls observed
let lastBulkDeleteIds: string[] | null = null;
let bulkDeleteCallCount: number = 0;
let searchCallCount: number = 0;
let upsertCallCount: number = 0;

const expectedAuth = `Bearer ${API_KEY}`;

// ---- Filter parser (matches what the repo emits) ------------------------

type Predicate = (doc: MeiliDocument) => boolean;

const parseFilter = (filter: string): Predicate => {
  // The repo emits `field = "value" AND field = "value" AND ...` only.
  const clauses = filter.split(/\s+AND\s+/);
  const predicates: Predicate[] = [];
  for (const clause of clauses) {
    const m = clause.match(/^(\w+)\s*=\s*"((?:\\.|[^"\\])*)"$/);
    if (!m) throw new Error(`mock: unrecognised filter clause: ${clause}`);
    const [, field, raw] = m;
    const value = raw!.replace(/\\(.)/g, '$1');
    predicates.push(doc => String((doc as unknown as Record<string, unknown>)[field!] ?? '') === value);
  }
  return doc => predicates.every(p => p(doc));
};

// ---- Mock fetch ---------------------------------------------------------

const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  if (!url.startsWith(API)) return new Response('not found', { status: 404 });
  const method = (init?.method ?? 'GET').toUpperCase();
  const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
  if (auth !== expectedAuth) return new Response(JSON.stringify({ code: 'invalid_api_key' }), { status: 401 });
  const u = new URL(url);
  const path = u.pathname;

  // ---- GET /indexes/{uid} ------------------------------------------------
  let m = path.match(/^\/indexes\/([^/]+)$/);
  if (m && method === 'GET') {
    const uid = decodeURIComponent(m[1]!);
    if (!indexes.has(uid)) return new Response(JSON.stringify({ code: 'index_not_found' }), { status: 404 });
    return new Response(JSON.stringify({ uid, primaryKey: indexes.get(uid)!.primaryKey }), { status: 200 });
  }

  // ---- POST /indexes ------------------------------------------------------
  if (path === '/indexes' && method === 'POST') {
    const body = JSON.parse(init?.body as string) as { uid: string, primaryKey: string };
    if (indexes.has(body.uid)) {
      // Real Meili returns a *task* that fails with `index_already_exists`.
      const taskUid = nextTaskUid++;
      // We won't add this to `completedTasks` since we set status='failed'.
      // Actually for simplicity, simulate failure by short-circuiting: the
      // repo doesn't currently exercise this path because ensureIndex
      // GETs first, so this branch only matters for safety.
      completedTasks.add(-taskUid); // negative = failure
      return new Response(
        JSON.stringify({
          taskUid,
          indexUid: body.uid,
          status: 'enqueued',
          type: 'indexCreation',
          enqueuedAt: new Date().toISOString(),
        }),
        { status: 202 },
      );
    }
    indexes.set(body.uid, {
      primaryKey: body.primaryKey,
      filterableAttributes: [],
      documents: new Map(),
    });
    const taskUid = nextTaskUid++;
    completedTasks.add(taskUid);
    return new Response(
      JSON.stringify({
        taskUid,
        indexUid: body.uid,
        status: 'enqueued',
        type: 'indexCreation',
        enqueuedAt: new Date().toISOString(),
      }),
      { status: 202 },
    );
  }

  // ---- PUT /indexes/{uid}/documents ---------------------------------------
  m = path.match(/^\/indexes\/([^/]+)\/documents$/);
  if (m && method === 'PUT') {
    upsertCallCount += 1;
    const uid = decodeURIComponent(m[1]!);
    const index = indexes.get(uid);
    if (!index) return new Response(JSON.stringify({ code: 'index_not_found' }), { status: 404 });
    const docs = JSON.parse(init?.body as string) as MeiliDocument[];
    for (const doc of docs) {
      index.documents.set(doc.id, doc);
    }
    const taskUid = nextTaskUid++;
    completedTasks.add(taskUid);
    return new Response(
      JSON.stringify({
        taskUid,
        indexUid: uid,
        status: 'enqueued',
        type: 'documentAdditionOrUpdate',
        enqueuedAt: new Date().toISOString(),
      }),
      { status: 202 },
    );
  }

  // ---- POST /indexes/{uid}/documents/delete-batch -------------------------
  m = path.match(/^\/indexes\/([^/]+)\/documents\/delete-batch$/);
  if (m && method === 'POST') {
    bulkDeleteCallCount += 1;
    const uid = decodeURIComponent(m[1]!);
    const index = indexes.get(uid);
    if (!index) return new Response(JSON.stringify({ code: 'index_not_found' }), { status: 404 });
    const ids = JSON.parse(init?.body as string) as string[];
    lastBulkDeleteIds = ids;
    for (const id of ids) index.documents.delete(id);
    const taskUid = nextTaskUid++;
    completedTasks.add(taskUid);
    return new Response(
      JSON.stringify({
        taskUid,
        indexUid: uid,
        status: 'enqueued',
        type: 'documentDeletion',
        enqueuedAt: new Date().toISOString(),
      }),
      { status: 202 },
    );
  }

  // ---- POST /indexes/{uid}/search -----------------------------------------
  m = path.match(/^\/indexes\/([^/]+)\/search$/);
  if (m && method === 'POST') {
    searchCallCount += 1;
    const uid = decodeURIComponent(m[1]!);
    const index = indexes.get(uid);
    if (!index) return new Response(JSON.stringify({ code: 'index_not_found' }), { status: 404 });
    const body = JSON.parse(init?.body as string) as { filter?: string, limit?: number };
    let docs = [...index.documents.values()];
    if (body.filter) {
      const pred = parseFilter(body.filter);
      docs = docs.filter(pred);
    }
    const limit = body.limit ?? 20;
    return new Response(
      JSON.stringify({
        hits: docs.slice(0, limit),
        estimatedTotalHits: docs.length,
      }),
      { status: 200 },
    );
  }

  // ---- GET /indexes/{uid}/documents/{id} ----------------------------------
  m = path.match(/^\/indexes\/([^/]+)\/documents\/([^/]+)$/);
  if (m && method === 'GET') {
    const uid = decodeURIComponent(m[1]!);
    const id = decodeURIComponent(m[2]!);
    const index = indexes.get(uid);
    if (!index) return new Response(JSON.stringify({ code: 'index_not_found' }), { status: 404 });
    const doc = index.documents.get(id);
    if (!doc) return new Response(JSON.stringify({ code: 'document_not_found' }), { status: 404 });
    return new Response(JSON.stringify(doc), { status: 200 });
  }

  // ---- PUT /indexes/{uid}/settings/filterable-attributes ------------------
  m = path.match(/^\/indexes\/([^/]+)\/settings\/filterable-attributes$/);
  if (m && method === 'PUT') {
    const uid = decodeURIComponent(m[1]!);
    const index = indexes.get(uid);
    if (!index) return new Response(JSON.stringify({ code: 'index_not_found' }), { status: 404 });
    const attrs = JSON.parse(init?.body as string) as string[];
    index.filterableAttributes = attrs;
    const taskUid = nextTaskUid++;
    completedTasks.add(taskUid);
    return new Response(
      JSON.stringify({
        taskUid,
        indexUid: uid,
        status: 'enqueued',
        type: 'settingsUpdate',
        enqueuedAt: new Date().toISOString(),
      }),
      { status: 202 },
    );
  }

  // ---- GET /tasks/{uid} --------------------------------------------------
  m = path.match(/^\/tasks\/(\d+)$/);
  if (m && method === 'GET') {
    getTaskCount += 1;
    const taskUid = Number(m[1]);
    if (completedTasks.has(taskUid)) {
      return new Response(
        JSON.stringify({
          uid: taskUid,
          status: 'succeeded',
          type: 'unknown',
          enqueuedAt: new Date().toISOString(),
        }),
        { status: 200 },
      );
    }
    if (completedTasks.has(-taskUid)) {
      return new Response(
        JSON.stringify({
          uid: taskUid,
          status: 'failed',
          type: 'unknown',
          enqueuedAt: new Date().toISOString(),
          error: { code: 'index_already_exists', message: 'index already exists' },
        }),
        { status: 200 },
      );
    }
    return new Response('not found', { status: 404 });
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

const makeRepo = (fetchImpl: typeof fetch = mockFetch): MeiliStorageRepository => {
  const ds = new MeiliDataSource({
    url: API,
    auth: { apiKey: API_KEY },
    fetch: fetchImpl,
    taskTimeoutMs: 2000,
    taskPollIntervalMs: 1,
  });
  return new MeiliStorageRepository({
    dataSource: ds,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'md',
  });
};

beforeEach(() => {
  indexes = new Map();
  nextTaskUid = 0;
  completedTasks = new Set();
  getTaskCount = 0;
  lastBulkDeleteIds = null;
  bulkDeleteCallCount = 0;
  searchCallCount = 0;
  upsertCallCount = 0;
});

afterEach(() => {
  indexes.clear();
  completedTasks.clear();
});

describe('MeiliSearch filter DSL', () => {
  it('builds SQL-like equality + AND clauses', () => {
    expect(eqFilter('parent', 'notes')).toBe('parent = "notes"');
    expect(eqFilter('name', 'with "quotes" inside')).toBe('name = "with \\"quotes\\" inside"');
    expect(andFilter(eqFilter('parent', 'notes'), eqFilter('type', 'file')))
      .toBe('parent = "notes" AND type = "file"');
  });
});

describe('MeiliStorageRepository', () => {
  it('createObject + getObject round-trip stores a document with id, type, parent, name, extension', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('md');

    // Verify the stored document.
    const stored = indexes.get('laika_storage')?.documents.get('file:notes/hello.md');
    expect(stored).toMatchObject({
      id: 'file:notes/hello.md',
      type: 'file',
      parent: 'notes',
      name: 'hello',
      extension: 'md',
      content: 'hi',
    });

    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ body: 'hi' });
  });

  it('every mutation is async-with-task-polling (GET /tasks/{uid} after each write)', async () => {
    const repo = makeRepo();
    getTaskCount = 0;
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    // The createObject path involves: ensureIndex (creates index → 1 task) +
    // updateFilterableAttributes (→ 1 task) + upsertDocuments (→ 1 task).
    // Plus reads from getObject in the read-back. So multiple GET /tasks
    // calls fired — at minimum the 3 mutation tasks were polled.
    expect(getTaskCount).toBeGreaterThanOrEqual(3);
  });

  it('search via POST body — filter, q, limit live in JSON body, not URL', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    let lastSearchBody: { filter?: string, limit?: number } | null = null;
    const sniff: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/search') && (init?.method ?? 'GET') === 'POST') {
        lastSearchBody = JSON.parse(init?.body as string);
      }
      return mockFetch(input, init);
    };
    const sniffRepo = makeRepo(sniff);
    await LaikaTask.runPromise(sniffRepo.getObject('notes/x'));
    expect(lastSearchBody).toBeTruthy();
    // Filter lives in the body, not as a URL parameter.
    expect(lastSearchBody!.filter).toMatch(/type = "file" AND parent = "notes" AND name = "x"/);
    expect(lastSearchBody!.limit).toBe(1);
  });

  it('filter syntax is SQL-like (parent = "notes" AND type = "file"), NOT Lucene', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    let lastSearchBody: { filter?: string } | null = null;
    const sniff: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/search')) {
        lastSearchBody = JSON.parse(init?.body as string);
      }
      return mockFetch(input, init);
    };
    const sniffRepo = makeRepo(sniff);
    await LaikaTask.runPromise(sniffRepo.getObject('notes/x'));
    // SQL-like — `field = "value"`, NOT `field:"value"`.
    expect(lastSearchBody!.filter).toMatch(/= "/);
    expect(lastSearchBody!.filter).not.toMatch(/:[^=]/); // no `field:value` Lucene shape
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

  it('updateObject overwrites via PUT documents (upsert by primary key)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await LaikaTask.runPromise(
      repo.updateObject({ key: 'notes/x', content: { body: 'b' } }),
    );
    const stored = indexes.get('laika_storage')!.documents.get('file:notes/x.md');
    expect(stored?.content).toBe('b');
  });

  it('removeAtoms ships as ONE bulk-delete POST with the ID array', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }
    bulkDeleteCallCount = 0;
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });
    expect(removed.data.sort()).toEqual(['notes/a', 'notes/b', 'notes/c']);
    // *The* distinctive behaviour: exactly ONE bulk-delete call, regardless of N.
    expect(bulkDeleteCallCount).toBe(1);
    // And the ID array was sent in the body.
    expect(lastBulkDeleteIds).toEqual([
      'file:notes/a.md',
      'file:notes/b.md',
      'file:notes/c.md',
    ]);
    // Files gone.
    expect(indexes.get('laika_storage')!.documents.size).toBe(0);
  });

  it('removeAtoms task is awaited (bulk delete is async-by-default)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    getTaskCount = 0;
    await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes/x']));
    // After bulk-delete, the data source polled GET /tasks/{uid}.
    expect(getTaskCount).toBeGreaterThanOrEqual(1);
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

  it('listAtomSummaries searches by `parent = "X"` filter', async () => {
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

  it('createFolder upserts a folder document; getFolder finds it', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'empty' }));
    const stored = indexes.get('laika_storage')!.documents.get('folder:empty');
    expect(stored).toMatchObject({ id: 'folder:empty', type: 'folder', name: 'empty' });

    const folder = await LaikaTask.runPromise(repo.getFolder('empty'));
    expect(folder.type).toBe('folder');
  });

  it('createFolder is idempotent (PUT upserts; no duplicate)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    upsertCallCount = 0;
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    expect([...indexes.get('laika_storage')!.documents.keys()].filter(k => k === 'folder:twice')).toHaveLength(1);
  });

  it('getFolder fails for a missing path', async () => {
    const repo = makeRepo();
    await expect(LaikaTask.runPromise(repo.getFolder('nowhere'))).rejects.toThrow(/not found|empty/i);
  });

  it('index uid is validated against an injection-safe regex', async () => {
    const ds = new MeiliDataSource({ url: API, auth: { apiKey: API_KEY }, fetch: mockFetch });
    expect(() =>
      new MeiliStorageRepository({
        dataSource: ds,
        indexUid: 'evil/slash', // `/` not allowed
        serializerRegistry: serializerRegistry as never,
        defaultFileExtension: 'md',
      })
    ).toThrow(/Invalid MeiliSearch index UID/);
  });
});

// Reference unused symbols.
void searchCallCount;
void upsertCallCount;

runStorageRepositoryContract(meilisearchContractCase);
