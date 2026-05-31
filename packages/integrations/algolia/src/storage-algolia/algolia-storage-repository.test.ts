import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { runStorageRepositoryContract } from 'laikacms/storage/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AlgoliaRecord, PARENT_ATTR, TYPE_ATTR } from './algolia-datasource.js';
import { AlgoliaStorageRepository } from './algolia-storage-repository.js';
import { algoliaContractCase } from './testing/index.js';

runStorageRepositoryContract(algoliaContractCase);

// ---------------------------------------------------------------------------
// In-memory Algolia mock — handles the four endpoints the repository hits:
// single-record GET/PUT/DELETE plus the `query` endpoint with a `_parent`
// filter. The filter parser intentionally only supports what the repository
// actually emits: `_parent:"<value>"`.
// ---------------------------------------------------------------------------

const APP_ID = 'app';
const API_KEY = 'admin-key';
const INDEX = 'laika-storage';
const API_URL = 'https://mock.algolia.test';

const createMockAlgolia = () => {
  const records = new Map<string, AlgoliaRecord>();

  const json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } });

  const parseParents = (params: string): string | null => {
    const decoded = new URLSearchParams(params).get('filters') ?? '';
    const match = decoded.match(/^_parent:"([^"]*)"$/);
    return match ? match[1] : null;
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const prefix = `/1/indexes/${INDEX}`;
    if (!url.pathname.startsWith(prefix)) return json({ message: 'bad index' }, { status: 404 });
    const rest = url.pathname.slice(prefix.length);

    // Verify auth headers — surface a 401 if they're missing/wrong.
    const hdrs = (init?.headers as Record<string, string> | undefined) ?? {};
    if (hdrs['X-Algolia-Application-Id'] !== APP_ID || hdrs['X-Algolia-API-Key'] !== API_KEY) {
      return json({ message: 'bad auth' }, { status: 401 });
    }

    // ---- Record CRUD ---------------------------------------------------
    const recordMatch = rest.match(/^\/(.+)$/);
    if (recordMatch && rest !== '/query' && rest !== '/deleteByQuery') {
      const objectID = decodeURIComponent(recordMatch[1]);
      if (method === 'GET') {
        const record = records.get(objectID);
        if (!record) return json({ message: 'ObjectID does not exist' }, { status: 404 });
        return json(record);
      }
      if (method === 'PUT') {
        const body = JSON.parse((init?.body as string) ?? '{}') as AlgoliaRecord;
        records.set(objectID, body);
        return json({ objectID, taskID: Math.floor(Math.random() * 1000) });
      }
      if (method === 'DELETE') {
        records.delete(objectID);
        return json({ taskID: Math.floor(Math.random() * 1000) });
      }
    }

    // ---- Query --------------------------------------------------------
    if (rest === '/query' && method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '{}') as { params: string };
      const parent = parseParents(body.params ?? '');
      if (parent === null) return json({ message: 'unsupported filter' }, { status: 400 });
      const hits = [...records.values()].filter(r => r[PARENT_ATTR] === parent);
      return json({ hits, nbPages: 1, page: 0, nbHits: hits.length });
    }

    return new Response(`{"unhandled":"${method} ${url.pathname}"}`, { status: 501 });
  };

  return { records, fetch: fetchImpl };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let mock: ReturnType<typeof createMockAlgolia>;

beforeEach(() => {
  mock = createMockAlgolia();
});
afterEach(() => {
  mock.records.clear();
});

const makeRepo = () =>
  new AlgoliaStorageRepository({
    auth: { applicationId: APP_ID, apiKey: API_KEY },
    indexName: INDEX,
    apiUrl: API_URL,
    fetch: mock.fetch,
    serializerRegistry: {
      md: {
        format: { mediaType: 'text/markdown' } as never,
        serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
        deserializeDocumentFileContents: async raw => ({ body: raw }),
      },
    },
    defaultFileExtension: 'md',
  });

const seedFile = (parent: string, name: string, body: string, ext = 'md') => {
  const objectID = parent === '' ? `${name}.${ext}` : `${parent}/${name}.${ext}`;
  mock.records.set(objectID, {
    objectID,
    [TYPE_ATTR]: 'file',
    [PARENT_ATTR]: parent,
    _extension: ext,
    _content: body,
    _createdAt: '2026-05-01T00:00:00.000Z',
    _updatedAt: '2026-05-01T00:00:00.000Z',
  });
};

const seedFolder = (parent: string, name: string) => {
  const objectID = parent === '' ? name : `${parent}/${name}`;
  mock.records.set(objectID, {
    objectID,
    [TYPE_ATTR]: 'folder',
    [PARENT_ATTR]: parent,
    _createdAt: '2026-05-01T00:00:00.000Z',
    _updatedAt: '2026-05-01T00:00:00.000Z',
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AlgoliaStorageRepository listing', () => {
  it('sorts numeric filenames naturally and strips extensions', async () => {
    seedFile('', '1', 'a');
    seedFile('', '2', 'b');
    seedFile('', '10', 'c');
    seedFile('', '11', 'd');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10', '11']);
  });

  it('classifies files as object-summary and folders as folder-summary', async () => {
    seedFolder('', 'notes');
    seedFile('', 'top', 'x');
    seedFile('notes', 'a', 'y');

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

describe('AlgoliaStorageRepository CRUD', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    expect(mock.records.get('hello.md')?._content).toBe('hi');

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });
    expect(mock.records.get('hello.md')?._content).toBe('updated');

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect(mock.records.has('hello.md')).toBe(false);
  });

  it('createObject auto-creates ancestor folder markers for deep keys', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c', content: { body: 'deep' } }),
    );

    expect(mock.records.get('a')?.[TYPE_ATTR]).toBe('folder');
    expect(mock.records.get('a/b')?.[TYPE_ATTR]).toBe('folder');
    expect(mock.records.get('a/b/c.md')?.[TYPE_ATTR]).toBe('file');
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

  it('createFolder writes a folder marker that subsequent listings expose', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));

    expect(mock.records.get('notes')?.[TYPE_ATTR]).toBe('folder');

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['notes']);
    expect(collected.data[0].type).toBe('folder-summary');
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
    expect(mock.records.has('notes')).toBe(true);
  });
});

describe('AlgoliaStorageRepository auth', () => {
  it('sends both headers on every request — wrong credentials surface as AuthenticationError', async () => {
    const repo = new AlgoliaStorageRepository({
      auth: { applicationId: APP_ID, apiKey: 'WRONG' },
      indexName: INDEX,
      apiUrl: API_URL,
      fetch: mock.fetch,
      serializerRegistry: {
        md: {
          format: { mediaType: 'text/markdown' } as never,
          serializeDocumentFileContents: async () => '',
          deserializeDocumentFileContents: async () => ({}),
        },
      },
      defaultFileExtension: 'md',
    });

    await expect(
      LaikaTask.runPromise(repo.getObject('whatever')),
    ).rejects.toThrow(/authentication/i);
  });
});
