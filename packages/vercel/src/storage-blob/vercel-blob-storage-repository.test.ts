import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VercelBlobDataSource } from './vercel-blob-datasource.js';
import { VercelBlobStorageRepository } from './vercel-blob-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory Vercel Blob mock. Three endpoints carry the test surface:
//
//   PUT  https://api/<pathname>?addRandomSuffix=0   → upload
//   GET  https://cdn/<pathname>                      → read by URL
//   POST https://api/delete  {urls: [...]}           → bulk delete by URL
//   GET  https://api/?prefix=…&cursor=…&limit=…      → paginated list
//
// The mock returns CDN URLs that map back to the same in-memory store.
// ---------------------------------------------------------------------------

const API = 'https://blob.test';
const CDN = 'https://cdn.blob.test';
const TOKEN = 'vercel_blob_rw_test';

interface StoredBlob {
  pathname: string;
  body: string;
  contentType?: string;
  uploadedAt: string;
  size: number;
}

let store: Map<string, StoredBlob>;
let putCount = 0;
let deleteCount = 0;

const cdnUrlFor = (pathname: string): string => `${CDN}/${pathname}`;
const pathnameFromCdnUrl = (url: string): string | null => {
  if (!url.startsWith(`${CDN}/`)) return null;
  return url.slice(CDN.length + 1);
};

const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  const method = (init?.method ?? 'GET').toUpperCase();
  const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];

  // ---- CDN read (no auth required) ---------------------------------------
  if (url.startsWith(`${CDN}/`)) {
    if (method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const pathname = pathnameFromCdnUrl(url)!;
    const blob = store.get(pathname);
    if (!blob) return new Response('Not found', { status: 404 });
    return new Response(blob.body, {
      status: 200,
      headers: { 'content-type': blob.contentType ?? 'application/octet-stream' },
    });
  }

  // Auth required on all other (API) endpoints.
  if (auth !== `Bearer ${TOKEN}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // ---- API: PUT /<pathname>?addRandomSuffix=0 ---------------------------
  if (method === 'PUT' && url.startsWith(`${API}/`) && !url.startsWith(`${API}/delete`)) {
    putCount += 1;
    const u = new URL(url);
    const pathname = u.pathname.replace(/^\/+/, '').split('/').map(decodeURIComponent).join('/');
    const body = init?.body;
    const text = typeof body === 'string'
      ? body
      : body instanceof Uint8Array
        ? new TextDecoder().decode(body)
        : '';
    const contentType = (init?.headers as Record<string, string> | undefined)?.['x-content-type'];
    store.set(pathname, {
      pathname,
      body: text,
      contentType,
      uploadedAt: new Date().toISOString(),
      size: text.length,
    });
    return new Response(JSON.stringify({
      url: cdnUrlFor(pathname),
      pathname,
      contentType,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // ---- API: POST /delete -------------------------------------------------
  if (method === 'POST' && url.startsWith(`${API}/delete`)) {
    deleteCount += 1;
    const body = JSON.parse(init?.body as string) as { urls: string[] };
    for (const u of body.urls) {
      const pathname = pathnameFromCdnUrl(u);
      if (pathname) store.delete(pathname);
    }
    return new Response(JSON.stringify({ deleted: body.urls.length }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  // ---- API: GET /?prefix=… ----------------------------------------------
  if (method === 'GET' && url.startsWith(`${API}/`)) {
    const u = new URL(url);
    const prefix = u.searchParams.get('prefix') ?? '';
    const limit = Number(u.searchParams.get('limit') ?? '1000');
    const matched = [...store.values()].filter(b => b.pathname.startsWith(prefix));
    matched.sort((a, b) => a.pathname.localeCompare(b.pathname));
    const page = matched.slice(0, limit);
    return new Response(JSON.stringify({
      blobs: page.map(b => ({
        url: cdnUrlFor(b.pathname),
        pathname: b.pathname,
        size: b.size,
        uploadedAt: b.uploadedAt,
      })),
      hasMore: matched.length > limit,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  return new Response('Not found', { status: 404 });
};

// ---------------------------------------------------------------------------
// Minimal test serializer registry.
// ---------------------------------------------------------------------------

const serializerRegistry = {
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw),
  },
};

const PAGE = { offset: 0, limit: 100 };

const makeRepo = (basePath?: string, fetchImpl: typeof fetch = mockFetch): VercelBlobStorageRepository => {
  const ds = new VercelBlobDataSource({
    auth: { token: TOKEN },
    apiUrl: API,
    fetch: fetchImpl,
  });
  return new VercelBlobStorageRepository({
    dataSource: ds,
    basePath,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'json',
  });
};

beforeEach(() => {
  store = new Map();
  putCount = 0;
  deleteCount = 0;
});

afterEach(() => {
  store.clear();
});

describe('VercelBlobStorageRepository', () => {
  it('createObject + getObject round-trip', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { title: 'hi' } as never }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('json');

    // Stored at pathname `notes/hello.json` — extension flattened into pathname.
    expect([...store.keys()]).toEqual(['notes/hello.json']);

    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ title: 'hi' });
  });

  it('createObject refuses to overwrite an existing key', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { a: 1 } as never }),
    );
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'notes/x', content: { a: 2 } as never }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('createOrUpdateObject overwrites in place with a single PUT', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createOrUpdateObject({ type: 'object', key: 'notes/x', content: { a: 1 } as never }),
    );
    putCount = 0;
    await LaikaTask.runPromise(
      repo.createOrUpdateObject({ type: 'object', key: 'notes/x', content: { a: 2 } as never }),
    );
    expect(putCount).toBe(1);
    expect([...store.keys()]).toEqual(['notes/x.json']);
    // Reread to confirm the body was actually replaced.
    const fetched = await LaikaTask.runPromise(repo.getObject('notes/x'));
    expect(fetched.content).toEqual({ a: 2 });
  });

  it('removeAtoms ships a single POST /delete for N keys', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { v: k } as never }),
      );
    }
    deleteCount = 0;
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });
    expect(removed.data.sort()).toEqual(['notes/a', 'notes/b', 'notes/c']);
    // The single round-trip — *the* distinctive behaviour of this backend.
    expect(deleteCount).toBe(1);
    expect(store.size).toBe(0);
  });

  it('removeAtoms reports missing keys as skipped', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { v: 'a' } as never }),
    );
    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes/a', 'notes/nope']));
    expect(removed.done).toEqual({ removed: 1, skipped: 1 });
    expect(removed.recoverableErrors.length).toBe(1);
    expect(removed.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('listAtomSummaries reconstructs subfolder grouping client-side', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { v: 1 } as never }),
    );
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/b', content: { v: 2 } as never }),
    );
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/sub/c', content: { v: 3 } as never }),
    );
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/sub/d', content: { v: 4 } as never }),
    );

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

  it('createFolder lays down a .keep marker; getFolder finds it', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'empty-folder' }));
    expect([...store.keys()]).toContain('empty-folder/.keep');
    const folder = await LaikaTask.runPromise(repo.getFolder('empty-folder'));
    expect(folder.type).toBe('folder');
  });

  it('getFolder fails for a non-existent folder', async () => {
    const repo = makeRepo();
    await expect(LaikaTask.runPromise(repo.getFolder('nowhere'))).rejects.toThrow(/not found/i);
  });

  it('resolveKey ignores subfolder entries under the same prefix', async () => {
    // The key `notes/foo` should NOT match an entry like `notes/foo/bar.json`.
    // resolveKey does this by checking that the tail after `notes/foo.` has no
    // further `/`.
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/foo/bar', content: { v: 1 } as never }),
    );
    await expect(LaikaTask.runPromise(repo.getObject('notes/foo'))).rejects.toThrow(/not found/i);
  });

  it('uploads always disable the random suffix', async () => {
    let lastPutUrl = '';
    const sniffingFetch: typeof fetch = async (input, init) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
        lastPutUrl = typeof input === 'string' ? input : (input as URL).toString();
      }
      return mockFetch(input, init);
    };
    const repo = makeRepo(undefined, sniffingFetch);
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/check', content: { v: 1 } as never }),
    );
    expect(lastPutUrl).toContain('addRandomSuffix=0');
  });

  it('basePath scopes every operation', async () => {
    const repo = makeRepo('tenant-a');
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { v: 1 } as never }),
    );
    expect([...store.keys()]).toEqual(['tenant-a/notes/x.json']);

    const fetched = await LaikaTask.runPromise(repo.getObject('notes/x'));
    expect(fetched.key).toBe('notes/x');
  });
});
