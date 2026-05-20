import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConvexDataSource } from './convex-datasource.js';
import { ConvexStorageRepository } from './convex-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory Convex HTTP RPC mock.
//
// Honors the Convex wire shape — `POST /api/{query,mutation}` with body
// `{path: "laika:func", args: {...}, format: "json"}` returning
// `{status: "success", value: ...}` or `{status: "error", errorMessage}`.
//
// The function dispatcher matches each `path` string to an in-memory
// handler that simulates the reference Convex functions from the README.
// ---------------------------------------------------------------------------

const API = 'https://my-app.convex.test';

interface FileRow {
  _id: string;
  _creationTime: number;
  path: string;
  parent: string;
  name: string;
  extension: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface FolderRow {
  _id: string;
  _creationTime: number;
  path: string;
  parent: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

let files: Map<string, FileRow>;            // keyed by path
let folders: Map<string, FolderRow>;        // keyed by path
let idCounter: number;
let queryCount: number;
let mutationCount: number;
let lastFunctionPath: string | null = null;
let lastFunctionKind: 'query' | 'mutation' | null = null;
let functionPaths: string[] = [];   // every function call this turn (in order)

const nextId = (): string => `k${(++idCounter).toString(36).padStart(8, '0')}`;
const now = (): number => Date.now();

// ---- Function handlers (mirror the reference convex/laika.ts) -----------

interface FunctionResult<T = unknown> { value?: T; error?: string }

const handlers: Record<string, (args: Record<string, unknown>, kind: 'query' | 'mutation') => FunctionResult> = {
  'laika:getFile': (args) => {
    const file = [...files.values()].find(
      f => f.parent === args['parent'] && f.name === args['name'],
    );
    return { value: file ?? null };
  },

  'laika:getFolder': (args) => {
    const folder = folders.get(String(args['path']));
    return { value: folder ?? null };
  },

  'laika:listChildren': (args) => {
    const parent = String(args['parent']);
    const fileChildren = [...files.values()]
      .filter(f => f.parent === parent)
      .map(f => ({ _id: f._id, type: 'file', path: f.path, parent: f.parent, name: f.name, extension: f.extension }));
    const folderChildren = [...folders.values()]
      .filter(f => f.parent === parent)
      .map(f => ({ _id: f._id, type: 'folder', path: f.path, parent: f.parent, name: f.name }));
    return { value: [...fileChildren, ...folderChildren] };
  },

  'laika:hasDescendants': (args) => {
    const parent = String(args['parent']);
    if (parent === '') {
      return { value: files.size > 0 || folders.size > 0 };
    }
    const any = [...files.values()].some(f => f.parent === parent)
              || [...folders.values()].some(f => f.parent === parent);
    return { value: any };
  },

  'laika:createFile': (args) => {
    const path = String(args['path']);
    // Application-level dup check — Convex's `create` mutation would
    // typically use `db.query(...).first() === null` then `db.insert(...)`.
    if (files.has(path)) {
      return { error: `Document already exists: ${path}` };
    }
    const row: FileRow = {
      _id: nextId(),
      _creationTime: now(),
      path,
      parent: String(args['parent']),
      name: String(args['name']),
      extension: String(args['extension'] ?? ''),
      content: String(args['content'] ?? ''),
      createdAt: String(args['createdAt'] ?? new Date().toISOString()),
      updatedAt: String(args['updatedAt'] ?? new Date().toISOString()),
    };
    files.set(path, row);
    return { value: row };
  },

  'laika:updateFile': (args) => {
    const path = String(args['path']);
    const existing = files.get(path);
    if (!existing) return { error: `Document not found: ${path}` };
    const merged: FileRow = {
      ...existing,
      content: args['content'] === undefined ? existing.content : String(args['content']),
      updatedAt: String(args['updatedAt'] ?? new Date().toISOString()),
    };
    files.set(path, merged);
    return { value: merged };
  },

  'laika:upsertFile': (args) => {
    const path = String(args['path']);
    const existing = files.get(path);
    const row: FileRow = {
      _id: existing?._id ?? nextId(),
      _creationTime: existing?._creationTime ?? now(),
      path,
      parent: String(args['parent']),
      name: String(args['name']),
      extension: String(args['extension'] ?? existing?.extension ?? ''),
      content: String(args['content'] ?? ''),
      createdAt: String(args['createdAt'] ?? existing?.createdAt ?? new Date().toISOString()),
      updatedAt: String(args['updatedAt'] ?? new Date().toISOString()),
    };
    files.set(path, row);
    return { value: row };
  },

  'laika:upsertFolder': (args) => {
    const path = String(args['path']);
    const existing = folders.get(path);
    const row: FolderRow = {
      _id: existing?._id ?? nextId(),
      _creationTime: existing?._creationTime ?? now(),
      path,
      parent: String(args['parent']),
      name: String(args['name']),
      createdAt: String(args['createdAt'] ?? existing?.createdAt ?? new Date().toISOString()),
      updatedAt: String(args['updatedAt'] ?? new Date().toISOString()),
    };
    folders.set(path, row);
    return { value: row };
  },

  /**
   * The interesting one — atomic batch delete inside a single mutation
   * call. The function loops over the path array and removes each in
   * one transaction.
   */
  'laika:removeFiles': (args) => {
    const paths = (args['paths'] ?? []) as string[];
    const removed: string[] = [];
    const missing: string[] = [];
    for (const path of paths) {
      if (files.has(path)) {
        files.delete(path);
        removed.push(path);
      } else {
        missing.push(path);
      }
    }
    return { value: { removed, missing } };
  },
};

// ---- Mock fetch ----------------------------------------------------------

const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  if (!url.startsWith(API)) return new Response('not found', { status: 404 });
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'POST') return new Response('method not allowed', { status: 405 });

  const u = new URL(url);
  let kind: 'query' | 'mutation';
  if (u.pathname === '/api/query') {
    kind = 'query';
    queryCount += 1;
  } else if (u.pathname === '/api/mutation') {
    kind = 'mutation';
    mutationCount += 1;
  } else {
    return new Response('not found', { status: 404 });
  }
  lastFunctionKind = kind;

  const body = JSON.parse(init?.body as string) as { path: string; args: Record<string, unknown>; format: string };
  lastFunctionPath = body.path;
  functionPaths.push(body.path);
  const handler = handlers[body.path];
  if (!handler) {
    return new Response(JSON.stringify({
      status: 'error',
      errorMessage: `Unknown function: ${body.path}`,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const result = handler(body.args, kind);
  if (result.error) {
    return new Response(JSON.stringify({
      status: 'error',
      errorMessage: result.error,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({
    status: 'success',
    value: result.value ?? null,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
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

const makeRepo = (fetchImpl: typeof fetch = mockFetch): ConvexStorageRepository => {
  const ds = new ConvexDataSource({
    url: API,
    fetch: fetchImpl,
  });
  return new ConvexStorageRepository({
    dataSource: ds,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'md',
  });
};

beforeEach(() => {
  files = new Map();
  folders = new Map();
  idCounter = 0;
  queryCount = 0;
  mutationCount = 0;
  lastFunctionPath = null;
  lastFunctionKind = null;
  functionPaths = [];
});

afterEach(() => {
  files.clear();
  folders.clear();
});

describe('ConvexStorageRepository', () => {
  it('createObject calls laika:createFile via POST /api/mutation', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('md');
    // The Convex _id surfaces as revisionId.
    expect(created.metadata?.revisionId).toMatch(/^k/);

    // Verify the stored row.
    const stored = files.get('notes/hello.md');
    expect(stored).toMatchObject({
      path: 'notes/hello.md',
      parent: 'notes',
      name: 'hello',
      extension: 'md',
      content: 'hi',
    });

    // Round-trip.
    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ body: 'hi' });
  });

  it('getObject calls laika:getFile via POST /api/query (not mutation)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    lastFunctionPath = null;
    lastFunctionKind = null;
    await LaikaTask.runPromise(repo.getObject('notes/x'));
    // *The* distinctive routing: queries hit /api/query, not /api/mutation.
    expect(lastFunctionKind).toBe('query');
    expect(lastFunctionPath).toBe('laika:getFile');
  });

  it('function path travels in the body under `path`, not the URL', async () => {
    const bodies: Array<{ path?: string; args?: unknown; format?: string }> = [];
    const sniff: typeof fetch = async (input, init) => {
      bodies.push(JSON.parse(init?.body as string));
      return mockFetch(input, init);
    };
    const repo = makeRepo(sniff);
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    // Find the CREATE mutation body (createObject does probe SELECT +
    // INSERT + read-back SELECT; we want the middle one).
    const createBody = bodies.find(b => b.path === 'laika:createFile');
    expect(createBody).toBeDefined();
    expect(createBody!.format).toBe('json');
    expect(createBody!.args).toMatchObject({ path: 'notes/x.md', name: 'x' });
  });

  it('responses are wrapped in {status: "success", value} envelopes', async () => {
    // Snoop the raw fetch response body.
    let lastRawBody: string | null = null;
    const sniff: typeof fetch = async (input, init) => {
      const response = await mockFetch(input, init);
      lastRawBody = await response.clone().text();
      return response;
    };
    const repo = makeRepo(sniff);
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    expect(lastRawBody).toBeTruthy();
    const parsed = JSON.parse(lastRawBody!);
    expect(parsed.status).toBe('success');
    expect(parsed).toHaveProperty('value');
  });

  it('error responses surface as typed Laika errors (e.g. EntryAlreadyExistsError)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    // Second create hits the {status: 'error', errorMessage: 'Document already exists: …'} envelope.
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'b' } }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('updateObject calls laika:updateFile mutation; content is overwritten', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await LaikaTask.runPromise(
      repo.updateObject({ key: 'notes/x', content: { body: 'b' } }),
    );
    expect(files.get('notes/x.md')?.content).toBe('b');
  });

  it('createOrUpdateObject calls laika:upsertFile (whether existing or not)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createOrUpdateObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    functionPaths = [];
    await LaikaTask.runPromise(
      repo.createOrUpdateObject({ type: 'object', key: 'notes/x', content: { body: 'b' } }),
    );
    // The mutation we want to verify was called, even though there are
    // also probe queries before/after.
    expect(functionPaths).toContain('laika:upsertFile');
    expect(files.get('notes/x.md')?.content).toBe('b');
  });

  it('removeAtoms ships as ONE mutation call with the path array', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }
    mutationCount = 0;
    queryCount = 0;
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });
    expect(removed.data.sort()).toEqual(['notes/a', 'notes/b', 'notes/c']);
    // Exactly ONE mutation call (laika:removeFiles), regardless of N.
    expect(mutationCount).toBe(1);
    // Plus 3 query calls (resolve laika:getFile per key).
    expect(queryCount).toBe(3);
    expect(files.size).toBe(0);
  });

  it('removeAtoms last mutation body carries the full path array as a parameter', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'a', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'b', content: { body: 'b' } }));

    let lastRemoveBody: { args?: { paths?: string[] } } | null = null;
    const sniff: typeof fetch = async (input, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : null;
      if (body?.path === 'laika:removeFiles') lastRemoveBody = body;
      return mockFetch(input, init);
    };
    const sniffRepo = new ConvexStorageRepository({
      dataSource: new ConvexDataSource({ url: API, fetch: sniff }),
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'md',
    });
    await LaikaStream.runPromiseCollect(sniffRepo.removeAtoms(['a', 'b']));
    expect(lastRemoveBody).toBeTruthy();
    expect(lastRemoveBody!.args!.paths).toEqual(['a.md', 'b.md']);
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

  it('listAtomSummaries calls laika:listChildren and reconstructs file/folder discrimination', async () => {
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

  it('createFolder calls laika:upsertFolder (idempotent)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    expect(folders.size).toBe(1);
    expect(functionPaths).toContain('laika:upsertFolder');
  });

  it('getFolder recognises implicit folders via laika:hasDescendants', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'x' } }),
    );
    const folder = await LaikaTask.runPromise(repo.getFolder('notes'));
    expect(folder.type).toBe('folder');
  });

  it('getFolder fails when neither explicit folder nor descendants exist', async () => {
    const repo = makeRepo();
    await expect(LaikaTask.runPromise(repo.getFolder('nowhere'))).rejects.toThrow(/not found|empty/i);
  });

  it('function paths are configurable for custom Convex module layouts', async () => {
    // The repository honours custom function paths. The cleanest way to
    // verify this is to sniff the wire call directly — the configured
    // path travels in the body.
    const bodies: Array<{ path?: string }> = [];
    const sniff: typeof fetch = async (input, init) => {
      bodies.push(JSON.parse(init?.body as string));
      return mockFetch(input, init);
    };
    const repo = new ConvexStorageRepository({
      dataSource: new ConvexDataSource({ url: API, fetch: sniff }),
      functions: { getFile: 'custom:fetch' },
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'md',
    });
    // Run a getObject — getFile is invoked with the configured path.
    // The mock doesn't recognise `custom:fetch`, so it'll return null
    // (via the "Unknown function" error path → swallowed by findFileRow).
    await expect(LaikaTask.runPromise(repo.getObject('any'))).rejects.toThrow(/not found/i);
    // But the configured path IS what hit the wire.
    expect(bodies.some(b => b.path === 'custom:fetch')).toBe(true);
  });
});
