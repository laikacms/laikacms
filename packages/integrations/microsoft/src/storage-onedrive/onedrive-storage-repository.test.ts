import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { runStorageRepositoryContract } from 'laikacms/storage/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OneDriveDataSource, type OneDriveItem } from './onedrive-datasource.js';
import { OneDriveStorageRepository } from './onedrive-storage-repository.js';
import { oneDriveContractCase } from './testing/index.js';

runStorageRepositoryContract(oneDriveContractCase);

// ---------------------------------------------------------------------------
// In-memory Microsoft Graph / OneDrive mock.
//
// Handles the path-addressed REST shape:
//
//   GET    /me/drive/root:/<path>:                  → metadata
//   GET    /me/drive/root:/<path>:/children         → list children
//   PUT    /me/drive/root:/<path>:/content?...      → upload
//   DELETE /me/drive/root:/<path>:                  → delete
//   POST   /me/drive/root:/<parent>:/children       → create folder
//   POST   /$batch  { requests: [...] }             → batch dispatcher
//
// The mock returns pre-signed downloadUrls like `https://cdn.test/dl/<path>`,
// which a separate fetch handler resolves against the same in-memory store.
// ---------------------------------------------------------------------------

const API = 'https://graph.test/v1.0';
const CDN = 'https://cdn.test';
const TOKEN = 'graph_test_token';

interface Item {
  id: string;
  name: string;
  path: string; // full path including the basePath prefix
  type: 'file' | 'folder';
  content?: string;
  mimeType?: string;
  parentPath: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  eTag: string;
}

let items: Map<string, Item>;
let idCounter: number;
let batchCallCount: number;
let putCount: number;
let cdnGetCount: number;

const nextId = (): string => {
  idCounter += 1;
  return `item${idCounter}`;
};
const nextETag = (): string => `"{${Math.random().toString(36).slice(2, 10)}}"`;

const downloadUrlFor = (path: string): string => `${CDN}/dl/${encodeURIComponent(path)}`;
const pathFromDownloadUrl = (url: string): string | null => {
  if (!url.startsWith(`${CDN}/dl/`)) return null;
  return decodeURIComponent(url.slice(CDN.length + 4));
};

const itemToGraphResponse = (item: Item): OneDriveItem => ({
  id: item.id,
  name: item.name,
  parentReference: { path: item.parentPath },
  ...(item.type === 'file'
    ? {
      file: { mimeType: item.mimeType },
      '@microsoft.graph.downloadUrl': downloadUrlFor(item.path),
    }
    : { folder: { childCount: 0 } }),
  size: item.content?.length ?? 0,
  createdDateTime: item.createdDateTime,
  lastModifiedDateTime: item.lastModifiedDateTime,
  eTag: item.eTag,
});

// ---- URL parser ----------------------------------------------------------

const parseGraphUrl = (
  url: string,
): { kind: 'metadata' | 'children' | 'content' | 'create-folder' | 'batch' | 'unknown', path?: string } => {
  if (url === `${API}/$batch` || url === '/$batch') return { kind: 'batch' };
  if (!url.startsWith(`${API}/me/drive/root`) && !url.startsWith('/me/drive/root')) return { kind: 'unknown' };

  const relative = url.startsWith(API) ? url.slice(API.length) : url;
  // Patterns:
  //   /me/drive/root                       → root metadata
  //   /me/drive/root:/<path>:              → metadata
  //   /me/drive/root:/<path>:/children     → children
  //   /me/drive/root:/<path>:/content?...  → upload
  //   /me/drive/root:/children             → root children
  //   /me/drive/root:/<path>:/children (POST) → create folder under <path>

  // Strip query string.
  const pathOnly = relative.split('?')[0]!;

  if (pathOnly === '/me/drive/root') return { kind: 'metadata', path: '' };
  // Root children endpoint has NO colons — the colon-segment syntax only
  // delimits a non-empty path.
  if (pathOnly === '/me/drive/root/children') return { kind: 'children', path: '' };
  if (pathOnly === '/me/drive/root/content') return { kind: 'content', path: '' };

  const match = pathOnly.match(/^\/me\/drive\/root:\/(.+?):(\/.*)?$/);
  if (!match) return { kind: 'unknown' };
  const encodedPath = match[1]!;
  const path = encodedPath.split('/').map(decodeURIComponent).join('/');
  const suffix = match[2] ?? '';

  if (suffix === '') return { kind: 'metadata', path };
  if (suffix === '/children') return { kind: 'children', path };
  if (suffix === '/content') return { kind: 'content', path };
  return { kind: 'unknown', path };
};

// ---- Dispatchers ---------------------------------------------------------

interface MockResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

const handleRequest = (
  method: string,
  url: string,
  body: unknown,
): MockResponse => {
  const parsed = parseGraphUrl(url);

  if (parsed.kind === 'metadata' && method === 'GET') {
    if (parsed.path === '') {
      return {
        status: 200,
        body: itemToGraphResponse({
          id: 'root',
          name: 'root',
          path: '',
          type: 'folder',
          parentPath: '',
          createdDateTime: new Date(0).toISOString(),
          lastModifiedDateTime: new Date(0).toISOString(),
          eTag: '"root"',
        }),
      };
    }
    const item = items.get(parsed.path!);
    if (!item) return { status: 404, body: { error: { code: 'itemNotFound' } } };
    return { status: 200, body: itemToGraphResponse(item) };
  }

  if (parsed.kind === 'metadata' && method === 'DELETE') {
    const item = items.get(parsed.path!);
    if (!item) return { status: 404, body: { error: { code: 'itemNotFound' } } };
    items.delete(parsed.path!);
    return { status: 204 };
  }

  if (parsed.kind === 'content' && method === 'PUT') {
    putCount += 1;
    // Extract conflict behavior from URL.
    const conflict = url.match(/conflictBehavior=(\w+)/)?.[1] ?? 'replace';
    const existing = items.get(parsed.path!);
    if (existing && conflict === 'fail') {
      return { status: 409, body: { error: { code: 'nameAlreadyExists', message: 'File already exists' } } };
    }
    const name = parsed.path!.includes('/') ? parsed.path!.slice(parsed.path!.lastIndexOf('/') + 1) : parsed.path!;
    const parentPath = parsed.path!.includes('/') ? parsed.path!.slice(0, parsed.path!.lastIndexOf('/')) : '';
    const now = new Date().toISOString();
    const item: Item = {
      id: existing?.id ?? nextId(),
      name,
      path: parsed.path!,
      type: 'file',
      content: typeof body === 'string' ? body : '',
      mimeType: 'application/octet-stream',
      parentPath,
      createdDateTime: existing?.createdDateTime ?? now,
      lastModifiedDateTime: now,
      eTag: nextETag(),
    };
    items.set(parsed.path!, item);
    return { status: existing ? 200 : 201, body: itemToGraphResponse(item) };
  }

  if (parsed.kind === 'children' && method === 'GET') {
    const parent = parsed.path!;
    const children = [...items.values()].filter(it => it.parentPath === parent);
    return { status: 200, body: { value: children.map(itemToGraphResponse) } };
  }

  if (parsed.kind === 'children' && method === 'POST') {
    const folderBody = body as { name?: string, folder?: unknown, '@microsoft.graph.conflictBehavior'?: string };
    const parent = parsed.path!;
    const name = folderBody.name!;
    const fullPath = parent === '' ? name : `${parent}/${name}`;
    if (items.has(fullPath) && folderBody['@microsoft.graph.conflictBehavior'] === 'fail') {
      return { status: 409, body: { error: { code: 'nameAlreadyExists', message: 'Folder already exists' } } };
    }
    const now = new Date().toISOString();
    const item: Item = {
      id: nextId(),
      name,
      path: fullPath,
      type: 'folder',
      parentPath: parent,
      createdDateTime: now,
      lastModifiedDateTime: now,
      eTag: nextETag(),
    };
    items.set(fullPath, item);
    return { status: 201, body: itemToGraphResponse(item) };
  }

  return { status: 404, body: { error: { code: 'itemNotFound', message: `mock: no route for ${method} ${url}` } } };
};

// ---- Mock fetch ----------------------------------------------------------

const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  const method = (init?.method ?? 'GET').toUpperCase();

  // ---- Pre-signed CDN download URL — no auth header ----------------------
  if (url.startsWith(`${CDN}/dl/`)) {
    cdnGetCount += 1;
    if (method !== 'GET') return new Response('method not allowed', { status: 405 });
    const path = pathFromDownloadUrl(url)!;
    const item = items.get(path);
    if (!item || item.type !== 'file') return new Response('not found', { status: 404 });
    return new Response(item.content ?? '', {
      status: 200,
      headers: { 'content-type': item.mimeType ?? 'application/octet-stream' },
    });
  }

  // ---- Auth check on Graph requests -------------------------------------
  const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
  if (auth !== `Bearer ${TOKEN}`) return new Response('Unauthorized', { status: 401 });

  // ---- $batch dispatch ---------------------------------------------------
  if (url === `${API}/$batch` && method === 'POST') {
    batchCallCount += 1;
    const body = JSON.parse(init?.body as string) as {
      requests: Array<{ id: string, method: string, url: string, body?: unknown }>,
    };
    const responses = body.requests.map(req => {
      const result = handleRequest(req.method.toUpperCase(), req.url, req.body);
      return { id: req.id, status: result.status, body: result.body };
    });
    return new Response(JSON.stringify({ responses }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  // ---- Direct (non-batch) request ---------------------------------------
  let parsedBody: unknown = undefined;
  if (init?.body) {
    parsedBody = typeof init.body === 'string' ? init.body : init.body;
    // For PUT /content the body is raw text; for POST /children it's JSON.
    if (init.body && typeof init.body === 'string' && init.body.startsWith('{')) {
      try {
        parsedBody = JSON.parse(init.body);
      } catch { /* keep as string */ }
    }
  }
  const result = handleRequest(method, url, parsedBody);
  return new Response(
    result.body !== undefined ? JSON.stringify(result.body) : null,
    { status: result.status, headers: { 'content-type': 'application/json' } },
  );
};

// ---------------------------------------------------------------------------
// Minimal serializer registry.
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

const makeRepo = (basePath?: string, fetchImpl: typeof fetch = mockFetch): OneDriveStorageRepository => {
  const ds = new OneDriveDataSource({
    auth: { accessToken: TOKEN },
    apiUrl: API,
    fetch: fetchImpl,
  });
  return new OneDriveStorageRepository({
    dataSource: ds,
    basePath,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'md',
  });
};

beforeEach(() => {
  items = new Map();
  idCounter = 0;
  batchCallCount = 0;
  putCount = 0;
  cdnGetCount = 0;
});

afterEach(() => {
  items.clear();
});

describe('OneDriveStorageRepository', () => {
  it('createObject + getObject round-trip', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('md');
    // eTag surfaces as revisionId.
    expect(created.metadata?.revisionId).toMatch(/^"\{/);

    // Stored at the native filesystem path — no .keep markers, no flat-blob hacks.
    expect(items.has('notes/hello.md')).toBe(true);
    expect(items.get('notes/hello.md')?.content).toBe('hi');

    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ body: 'hi' });
  });

  it('reads content via the pre-signed @microsoft.graph.downloadUrl, not /content', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    cdnGetCount = 0;
    await LaikaTask.runPromise(repo.getObject('notes/x'));
    // *The* distinctive trait — content is fetched from the CDN URL, not
    // the authenticated Graph endpoint.
    expect(cdnGetCount).toBe(1);
  });

  it('createObject uses conflictBehavior=fail; duplicates surface as EntryAlreadyExistsError', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'b' } }),
      ),
    ).rejects.toThrow(/already exists|conflict/i);
  });

  it('removeAtoms ships as ONE $batch request with N DELETE sub-requests', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }
    batchCallCount = 0;
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });
    expect(removed.data.sort()).toEqual(['notes/a', 'notes/b', 'notes/c']);

    // *The* distinctive trait. resolveFile also uses $batch (one per key),
    // so the total batchCallCount is 4 (3 resolves + 1 delete).
    // But the DELETEs themselves are packed into exactly ONE $batch call.
    expect(batchCallCount).toBe(4);
    expect(items.size).toBe(0);
  });

  it('resolveFile uses $batch to probe extensions in parallel', async () => {
    // Verify: a single getObject() triggers exactly 1 $batch (for the
    // resolveFile probe across N extensions) plus the CDN content fetch.
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    batchCallCount = 0;
    cdnGetCount = 0;
    await LaikaTask.runPromise(repo.getObject('notes/x'));
    // ONE batch probes md + json in parallel. CDN content fetch is one.
    expect(batchCallCount).toBe(1);
    expect(cdnGetCount).toBe(1);
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
    expect(removed.recoverableErrors.length).toBe(1);
    expect(removed.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('listAtomSummaries uses native server-side hierarchy', async () => {
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

  it('createFolder creates a real OneDrive folder (no .keep marker)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'empty' }));
    const stored = items.get('empty');
    expect(stored?.type).toBe('folder');
    // No `.keep` placeholder — OneDrive supports empty folders natively.
    expect(items.has('empty/.keep')).toBe(false);
  });

  it('createFolder is idempotent (Graph 409 swallowed)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    expect(items.size).toBe(1);
  });

  it('getFolder fails for a missing path', async () => {
    const repo = makeRepo();
    await expect(LaikaTask.runPromise(repo.getFolder('nowhere'))).rejects.toThrow(/not found/i);
  });

  it('basePath scopes every operation', async () => {
    const repo = makeRepo('cms');
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    expect(items.has('cms/notes/x.md')).toBe(true);
    const fetched = await LaikaTask.runPromise(repo.getObject('notes/x'));
    expect(fetched.key).toBe('notes/x');
  });

  it('$batch URL format uses the path-addressed `root:/<path>:` syntax', async () => {
    // Sniff a batch DELETE to verify the path-addressed URL syntax.
    let lastBatchBody: { requests?: Array<{ url?: string }> } | null = null;
    const sniff: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url === `${API}/$batch` && (init?.method ?? 'GET') === 'POST') {
        lastBatchBody = JSON.parse(init!.body as string);
      }
      return mockFetch(input, init);
    };
    const repo = makeRepo(undefined, sniff);
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }),
    );
    await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes/a']));
    // The DELETE sub-request URL has the colon-segment shape.
    expect(lastBatchBody!.requests!.some(r => r.url?.startsWith('/me/drive/root:/notes/a.md:'))).toBe(true);
  });
});
