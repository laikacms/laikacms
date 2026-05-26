import * as Effect from 'effect/Effect';
import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WebDavConfig } from '../datasources/webdav-datasource.js';
import { WebDavStorageRepository } from './webdav-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory WebDAV server, just enough of RFC 4918 to exercise the repository.
// Keyed by server-absolute pathname; the root collection is created up-front
// so `MKCOL` always has a parent.
// ---------------------------------------------------------------------------

interface MockResource {
  isCollection: boolean;
  content: string;
  ctime: Date;
  mtime: Date;
}

const ROOT_PATH = '/dav';

const segmentsOf = (path: string): string[] => path.split('/').filter(s => s.length > 0);

const encodeHref = (path: string): string => '/' + segmentsOf(path).map(encodeURIComponent).join('/');

const buildPropfindXml = (resources: Array<{ path: string, resource: MockResource }>): string => {
  const inner = resources
    .map(({ path, resource }) => `
      <d:response>
        <d:href>${encodeHref(path)}${resource.isCollection ? '/' : ''}</d:href>
        <d:propstat>
          <d:prop>
            <d:resourcetype>${resource.isCollection ? '<d:collection/>' : ''}</d:resourcetype>
            ${resource.isCollection ? '' : `<d:getcontentlength>${resource.content.length}</d:getcontentlength>`}
            <d:getlastmodified>${resource.mtime.toUTCString()}</d:getlastmodified>
            <d:creationdate>${resource.ctime.toISOString()}</d:creationdate>
          </d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>`)
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${inner}</d:multistatus>`;
};

const createMockServer = () => {
  const store = new Map<string, MockResource>();
  store.set(ROOT_PATH, { isCollection: true, content: '', ctime: new Date(0), mtime: new Date(0) });

  const directChildrenOf = (path: string): Array<{ path: string, resource: MockResource }> => {
    const parentSegs = segmentsOf(path);
    const out: Array<{ path: string, resource: MockResource }> = [];
    for (const [otherPath, resource] of store) {
      if (otherPath === path) continue;
      const segs = segmentsOf(otherPath);
      if (segs.length !== parentSegs.length + 1) continue;
      if (parentSegs.every((seg, i) => seg === segs[i])) {
        out.push({ path: otherPath, resource });
      }
    }
    return out;
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const path = decodeURIComponent(url.pathname);
    const method = (init?.method ?? 'GET').toUpperCase();
    const resource = store.get(path);

    if (method === 'PROPFIND') {
      if (!resource) return new Response('', { status: 404 });
      const depth = (init?.headers as Record<string, string> | undefined)?.['Depth'] ?? '0';
      const entries: Array<{ path: string, resource: MockResource }> = [{ path, resource }];
      if (depth === '1' && resource.isCollection) entries.push(...directChildrenOf(path));
      return new Response(buildPropfindXml(entries), {
        status: 207,
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      });
    }
    if (method === 'GET') {
      if (!resource || resource.isCollection) return new Response('', { status: 404 });
      return new Response(resource.content, { status: 200 });
    }
    if (method === 'PUT') {
      const parent = '/' + segmentsOf(path).slice(0, -1).join('/');
      if (!store.has(parent)) return new Response('', { status: 409 });
      const now = new Date();
      const body = typeof init?.body === 'string' ? init.body : '';
      const existing = store.get(path);
      store.set(path, {
        isCollection: false,
        content: body,
        ctime: existing?.ctime ?? now,
        mtime: now,
      });
      return new Response(null, { status: existing ? 204 : 201 });
    }
    if (method === 'DELETE') {
      if (!resource) return new Response('', { status: 404 });
      store.delete(path);
      return new Response(null, { status: 204 });
    }
    if (method === 'MKCOL') {
      if (store.has(path)) return new Response('', { status: 405 });
      const parent = '/' + segmentsOf(path).slice(0, -1).join('/');
      if (!store.has(parent)) return new Response('', { status: 409 });
      const now = new Date();
      store.set(path, { isCollection: true, content: '', ctime: now, mtime: now });
      return new Response('', { status: 201 });
    }
    return new Response('', { status: 405 });
  };

  return { store, fetch: fetchImpl };
};

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let server: ReturnType<typeof createMockServer>;

beforeEach(() => {
  server = createMockServer();
});

afterEach(() => {
  server.store.clear();
});

const makeRepo = () => {
  const config: WebDavConfig = {
    baseUrl: `http://dav.test${ROOT_PATH}`,
    fetch: server.fetch,
  };
  return new WebDavStorageRepository(
    config,
    {
      md: {
        format: { mediaType: 'text/markdown' } as never,
        serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
        deserializeDocumentFileContents: async raw => ({ body: raw }),
      },
    },
    'md',
  );
};

const seedFile = (relPath: string, content = ''): void => {
  const full = `${ROOT_PATH}/${relPath}`;
  const parents = segmentsOf(relPath).slice(0, -1);
  for (let i = 1; i <= parents.length; i++) {
    const parentPath = `${ROOT_PATH}/${parents.slice(0, i).join('/')}`;
    if (!server.store.has(parentPath)) {
      server.store.set(parentPath, {
        isCollection: true,
        content: '',
        ctime: new Date(0),
        mtime: new Date(0),
      });
    }
  }
  server.store.set(full, {
    isCollection: false,
    content,
    ctime: new Date(0),
    mtime: new Date(0),
  });
};

// ---------------------------------------------------------------------------
// Tests — mirror the filesystem repository's contract suite.
// ---------------------------------------------------------------------------

describe('WebDavStorageRepository natural ordering', () => {
  it('sorts numeric filenames naturally (2 before 10)', async () => {
    seedFile('1.md');
    seedFile('2.md');
    seedFile('10.md');
    seedFile('11.md');

    const repo = makeRepo();
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10', '11']);
  });

  it('sorts mixed numeric/alpha names naturally', async () => {
    seedFile('invoice-2.md');
    seedFile('invoice-10.md');
    seedFile('invoice-1.md');

    const repo = makeRepo();
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key)).toEqual(['invoice-1', 'invoice-2', 'invoice-10']);
  });
});

describe('WebDavStorageRepository listing a missing folder', () => {
  it('listAtomSummaries yields no data and a NotFoundError as a recoverable error', async () => {
    const repo = makeRepo();
    const stream = repo.listAtomSummaries('does/not/exist', { pagination: { offset: 0, limit: 100 } });
    const collected = await Effect.runPromise(LaikaStream.runCollect(stream));

    expect(collected.data).toEqual([]);
    expect(collected.done).toEqual({ total: 0 });
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('listAtoms yields no data and a NotFoundError as a recoverable error', async () => {
    const repo = makeRepo();
    const stream = repo.listAtoms('does/not/exist', { pagination: { offset: 0, limit: 100 } });
    const collected = await Effect.runPromise(LaikaStream.runCollect(stream));

    expect(collected.data).toEqual([]);
    expect(collected.done).toEqual({ total: 0 });
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });
});

describe('WebDavStorageRepository CRUD round-trip', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(server.store.has(`${ROOT_PATH}/hello.md`)).toBe(true);

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });
    expect(server.store.get(`${ROOT_PATH}/hello.md`)?.content).toBe('updated');

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect(server.store.has(`${ROOT_PATH}/hello.md`)).toBe(false);
  });

  it('createFolder creates a collection and refuses to delete it while non-empty', async () => {
    const repo = makeRepo();

    const folder = await LaikaTask.runPromise(
      repo.createFolder({ type: 'folder', key: 'notes' }),
    );
    expect(folder).toMatchObject({ type: 'folder', key: 'notes' });
    expect(server.store.get(`${ROOT_PATH}/notes`)?.isCollection).toBe(true);

    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'x' } }),
    );

    const attempt = await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes']));
    expect(attempt.data).toEqual([]);
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
  });
});
