import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DropboxStorageRepository } from './dropbox-storage-repository.js';

// ---------------------------------------------------------------------------
// Tiny in-memory Dropbox — handles the subset of the v2 API the repository
// touches: get_metadata, list_folder, list_folder/continue, create_folder_v2,
// delete_v2, files/upload (content host), files/download (content host).
// Paths are POSIX-style with a leading slash, matching the real API.
// ---------------------------------------------------------------------------

interface MockEntry {
  '.tag': 'file' | 'folder';
  path: string;        // canonical e.g. '/notes/a.md'
  content: string;
  server_modified: string;
  client_modified: string;
  rev: string;
}

const API_URL = 'https://mock-api.dropboxapi.test/2';
const CONTENT_URL = 'https://mock-content.dropboxapi.test/2';

const segmentsOf = (path: string): string[] => path.split('/').filter(s => s.length > 0);
const parentOf = (path: string): string => {
  const segs = segmentsOf(path);
  return segs.length <= 1 ? '' : '/' + segs.slice(0, -1).join('/');
};

const createMockDropbox = () => {
  const store = new Map<string, MockEntry>();
  let revCounter = 0;
  const newRev = (): string => {
    revCounter += 1;
    return `rev${revCounter.toString(16).padStart(8, '0')}`;
  };

  const notFoundResponse = (path: string) =>
    new Response(
      JSON.stringify({ error_summary: `path/not_found/.${path}`, error: { '.tag': 'path', path: { '.tag': 'not_found' } } }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    );

  const conflictResponse = (path: string) =>
    new Response(
      JSON.stringify({ error_summary: `path/conflict/${path}`, error: { '.tag': 'path', path: { '.tag': 'conflict' } } }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    );

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const path = url.pathname;
    const body = init?.body ? (typeof init.body === 'string' ? init.body : '') : '';

    // ---- get_metadata --------------------------------------------------
    if (path === '/2/files/get_metadata') {
      const { path: filePath } = JSON.parse(body) as { path: string };
      const entry = store.get(filePath);
      if (!entry) return notFoundResponse(filePath);
      return new Response(
        JSON.stringify({
          '.tag': entry['.tag'],
          name: segmentsOf(entry.path).pop() ?? '',
          path_display: entry.path,
          path_lower: entry.path.toLowerCase(),
          ...(entry['.tag'] === 'file'
            ? {
              client_modified: entry.client_modified,
              server_modified: entry.server_modified,
              rev: entry.rev,
              size: entry.content.length,
            }
            : {}),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ---- list_folder / list_folder/continue -----------------------------
    if (path === '/2/files/list_folder' || path === '/2/files/list_folder/continue') {
      let folderPath: string;
      if (path === '/2/files/list_folder') {
        folderPath = (JSON.parse(body) as { path: string }).path;
        if (folderPath !== '' && !store.has(folderPath)) {
          // Returning 409 mirrors Dropbox's behaviour for missing folders.
          return notFoundResponse(folderPath);
        }
      } else {
        // Treat the cursor as the folder path for the mock.
        folderPath = (JSON.parse(body) as { cursor: string }).cursor;
      }
      const children: MockEntry[] = [];
      for (const [p, entry] of store) {
        if (p === folderPath) continue;
        if (parentOf(p) !== folderPath) continue;
        children.push(entry);
      }
      return new Response(
        JSON.stringify({
          entries: children.map(c => ({
            '.tag': c['.tag'],
            name: segmentsOf(c.path).pop() ?? '',
            path_display: c.path,
            path_lower: c.path.toLowerCase(),
            ...(c['.tag'] === 'file'
              ? { client_modified: c.client_modified, server_modified: c.server_modified, rev: c.rev, size: c.content.length }
              : {}),
          })),
          cursor: folderPath,
          has_more: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ---- create_folder_v2 ----------------------------------------------
    if (path === '/2/files/create_folder_v2') {
      const { path: folderPath } = JSON.parse(body) as { path: string };
      if (store.has(folderPath)) return conflictResponse(folderPath);
      const now = new Date().toISOString();
      const entry: MockEntry = {
        '.tag': 'folder',
        path: folderPath,
        content: '',
        server_modified: now,
        client_modified: now,
        rev: '',
      };
      store.set(folderPath, entry);
      return new Response(
        JSON.stringify({
          metadata: {
            '.tag': 'folder',
            name: segmentsOf(folderPath).pop() ?? '',
            path_display: folderPath,
            path_lower: folderPath.toLowerCase(),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ---- delete_v2 ------------------------------------------------------
    if (path === '/2/files/delete_v2') {
      const { path: filePath } = JSON.parse(body) as { path: string };
      if (!store.has(filePath)) return notFoundResponse(filePath);
      const entry = store.get(filePath)!;
      store.delete(filePath);
      return new Response(
        JSON.stringify({ metadata: entry }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ---- content host: upload ------------------------------------------
    if (path === '/2/files/upload') {
      const arg = (init?.headers as Record<string, string> | undefined)?.['Dropbox-API-Arg']
        ?? (init?.headers as Record<string, string> | undefined)?.['dropbox-api-arg']
        ?? '{}';
      const { path: filePath, mode } = JSON.parse(arg) as { path: string; mode: unknown };
      if (mode === 'add' && store.has(filePath)) return conflictResponse(filePath);
      const now = new Date().toISOString();
      const entry: MockEntry = {
        '.tag': 'file',
        path: filePath,
        content: body,
        server_modified: now,
        client_modified: now,
        rev: newRev(),
      };
      store.set(filePath, entry);
      return new Response(
        JSON.stringify({
          '.tag': 'file',
          name: segmentsOf(filePath).pop() ?? '',
          path_display: filePath,
          path_lower: filePath.toLowerCase(),
          client_modified: entry.client_modified,
          server_modified: entry.server_modified,
          rev: entry.rev,
          size: body.length,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ---- content host: download ----------------------------------------
    if (path === '/2/files/download') {
      const arg = (init?.headers as Record<string, string> | undefined)?.['Dropbox-API-Arg']
        ?? (init?.headers as Record<string, string> | undefined)?.['dropbox-api-arg']
        ?? '{}';
      const { path: filePath } = JSON.parse(arg) as { path: string };
      const entry = store.get(filePath);
      if (!entry || entry['.tag'] !== 'file') return notFoundResponse(filePath);
      return new Response(entry.content, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'dropbox-api-result': JSON.stringify({
            '.tag': 'file',
            name: segmentsOf(filePath).pop() ?? '',
            path_display: filePath,
            rev: entry.rev,
            size: entry.content.length,
            client_modified: entry.client_modified,
            server_modified: entry.server_modified,
          }),
        },
      });
    }

    return new Response(`{"unhandled":"${path}"}`, { status: 501 });
  };

  return { store, fetch: fetchImpl };
};

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let drop: ReturnType<typeof createMockDropbox>;

beforeEach(() => { drop = createMockDropbox(); });
afterEach(() => { drop.store.clear(); });

const makeRepo = (rootPath = '') =>
  new DropboxStorageRepository({
    auth: { accessToken: 'sl.fake' },
    apiUrl: API_URL,
    contentUrl: CONTENT_URL,
    rootPath,
    fetch: drop.fetch,
    serializerRegistry: {
      md: {
        format: { mediaType: 'text/markdown' } as never,
        serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
        deserializeDocumentFileContents: async raw => ({ body: raw }),
      },
    },
    defaultFileExtension: 'md',
  });

const seedFile = (path: string, content: string) => {
  drop.store.set(path, {
    '.tag': 'file',
    path,
    content,
    server_modified: new Date('2026-05-01').toISOString(),
    client_modified: new Date('2026-05-01').toISOString(),
    rev: 'seed-rev',
  });
};

const seedFolder = (path: string) => {
  drop.store.set(path, {
    '.tag': 'folder',
    path,
    content: '',
    server_modified: new Date('2026-05-01').toISOString(),
    client_modified: new Date('2026-05-01').toISOString(),
    rev: '',
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DropboxStorageRepository listing', () => {
  it('sorts numeric filenames naturally and strips extensions', async () => {
    seedFile('/1.md', 'a');
    seedFile('/2.md', 'b');
    seedFile('/10.md', 'c');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10']);
  });

  it('classifies files as object-summary and folders as folder-summary', async () => {
    seedFolder('/notes');
    seedFile('/top.md', 'x');

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

  it('respects rootPath — paths above the configured root are invisible', async () => {
    seedFolder('/site-a');
    seedFile('/site-a/hello.md', 'hi');
    seedFile('/outside.md', 'leak');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo('/site-a').listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key)).toEqual(['hello']);
  });
});

describe('DropboxStorageRepository CRUD', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    expect(created.metadata?.revisionId).toBeTruthy();
    expect(drop.store.get('/hello.md')?.content).toBe('hi');

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });
    expect(updated.metadata?.revisionId).not.toBe(created.metadata?.revisionId);
    expect(drop.store.get('/hello.md')?.content).toBe('updated');

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect(drop.store.has('/hello.md')).toBe(false);
  });

  it('createObject ensures the ancestor folder chain for deep keys', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c', content: { body: 'deep' } }),
    );

    expect(drop.store.get('/a')?.['.tag']).toBe('folder');
    expect(drop.store.get('/a/b')?.['.tag']).toBe('folder');
    expect(drop.store.get('/a/b/c.md')?.['.tag']).toBe('file');
  });

  it('rejects a second createObject for the same key', async () => {
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

  it('createFolder writes a real Dropbox folder (no .keep placeholder)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));

    expect(drop.store.get('/notes')?.['.tag']).toBe('folder');
    expect([...drop.store.keys()].some(p => p.endsWith('.keep'))).toBe(false);
  });

  it('refuses to delete a non-empty folder (recoverable warning, not fatal)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'x' } }),
    );

    const attempt = await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes']));
    expect(attempt.data).toEqual([]);
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
    expect(drop.store.has('/notes')).toBe(true);
  });
});

describe('DropboxStorageRepository token refresh', () => {
  it('calls tokenProvider before every request, picking up refreshed tokens', async () => {
    let callCount = 0;
    const repo = new DropboxStorageRepository({
      auth: { tokenProvider: () => { callCount += 1; return `t-${callCount}`; } },
      apiUrl: API_URL,
      contentUrl: CONTENT_URL,
      fetch: drop.fetch,
      serializerRegistry: {
        md: {
          format: { mediaType: 'text/markdown' } as never,
          serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
          deserializeDocumentFileContents: async raw => ({ body: raw }),
        },
      },
      defaultFileExtension: 'md',
    });

    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(callCount).toBeGreaterThan(1);
  });
});
