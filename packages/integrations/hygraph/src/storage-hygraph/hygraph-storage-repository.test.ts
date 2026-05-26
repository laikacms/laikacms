import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HygraphStorageRepository } from './hygraph-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory Hygraph mock. The repository names every GraphQL operation, so
// the mock dispatches by `operationName` rather than parsing the query body
// — that's the cleanest separation between "what the wire looks like" and
// "what behaviour the mock implements".
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://mock.hygraph.test/graphql';

interface FileNode {
  id: string;
  parent: string;
  name: string;
  path: string;
  extension: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
interface FolderNode {
  id: string;
  parent: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

const createMockHygraph = () => {
  const files = new Map<string, FileNode>();
  const folders = new Map<string, FolderNode>();
  let idCounter = 0;
  const newId = (prefix: string): string => `${prefix}-${++idCounter}`;
  const now = (): string => new Date().toISOString();

  const json = (data: unknown) =>
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  type Vars = Record<string, unknown>;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.toString() !== ENDPOINT) return new Response('bad endpoint', { status: 404 });
    const body = JSON.parse((init?.body as string) ?? '{}') as {
      query?: string,
      variables?: Vars,
      operationName?: string,
    };
    const op = body.operationName ?? '';
    const vars = body.variables ?? {};

    switch (op) {
      case 'FindLaikaObject': {
        const names = (vars.names as string[]) ?? [];
        const hit = [...files.values()].find(f => f.parent === vars.parent && names.includes(f.name));
        return json({ laikaObjects: hit ? [hit] : [] });
      }
      case 'GetLaikaFolder': {
        const hit = [...folders.values()].find(f => f.path === vars.path);
        return json({ laikaFolders: hit ? [hit] : [] });
      }
      case 'FindLaikaFolderByParentName': {
        const hit = [...folders.values()].find(f => f.parent === vars.parent && f.name === vars.name);
        return json({ laikaFolders: hit ? [hit] : [] });
      }
      case 'ListLaikaChildren': {
        const childFiles = [...files.values()].filter(f => f.parent === vars.parent);
        const childFolders = [...folders.values()].filter(f => f.parent === vars.parent);
        return json({ laikaObjects: childFiles, laikaFolders: childFolders });
      }
      case 'CreateLaikaObject': {
        const data = vars.data as Omit<FileNode, 'id' | 'createdAt' | 'updatedAt'>;
        const id = newId('file');
        const ts = now();
        const node: FileNode = { id, ...data, createdAt: ts, updatedAt: ts };
        files.set(id, node);
        return json({ createLaikaObject: node });
      }
      case 'UpdateLaikaObject': {
        const id = vars.id as string;
        const data = vars.data as Partial<FileNode>;
        const existing = files.get(id);
        if (!existing) return new Response(JSON.stringify({ errors: [{ message: 'not found' }] }), { status: 200 });
        const updated: FileNode = { ...existing, ...data, updatedAt: now() };
        files.set(id, updated);
        return json({ updateLaikaObject: updated });
      }
      case 'DeleteLaikaObject': {
        const id = vars.id as string;
        files.delete(id);
        return json({ deleteLaikaObject: { id } });
      }
      case 'CreateLaikaFolder': {
        const data = vars.data as Omit<FolderNode, 'id' | 'createdAt' | 'updatedAt'>;
        const id = newId('folder');
        const ts = now();
        const node: FolderNode = { id, ...data, createdAt: ts, updatedAt: ts };
        folders.set(id, node);
        return json({ createLaikaFolder: node });
      }
      case 'DeleteLaikaFolder': {
        const id = vars.id as string;
        folders.delete(id);
        return json({ deleteLaikaFolder: { id } });
      }
      default:
        return new Response(JSON.stringify({ errors: [{ message: `unhandled op: ${op}` }] }), { status: 200 });
    }
  };

  return { files, folders, fetch: fetchImpl };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let mock: ReturnType<typeof createMockHygraph>;

beforeEach(() => {
  mock = createMockHygraph();
});
afterEach(() => {
  mock.files.clear();
  mock.folders.clear();
});

const makeRepo = () =>
  new HygraphStorageRepository({
    endpoint: ENDPOINT,
    auth: { token: 'hygraph-test' },
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HygraphStorageRepository CRUD', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    expect(created.metadata?.revisionId).toBeTruthy();
    const onWire = [...mock.files.values()].find(f => f.name === 'hello.md');
    expect(onWire?.content).toBe('hi');

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect([...mock.files.values()].some(f => f.name === 'hello.md')).toBe(false);
  });

  it('auto-creates ancestor folders for deep keys via the GraphQL mutation', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c', content: { body: 'deep' } }),
    );

    const paths = [...mock.folders.values()].map(f => f.path).sort();
    expect(paths).toEqual(['a', 'a/b']);
    const file = [...mock.files.values()].find(f => f.path === 'a/b/c');
    expect(file?.content).toBe('deep');
  });

  it('rejects a duplicate createObject for the same key', async () => {
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
});

describe('HygraphStorageRepository listing', () => {
  it('lists files + folders in one GraphQL query', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'top', content: { body: 'x' } }));

    // Watch the wire — listing should fire exactly one ListLaikaChildren op.
    let listCount = 0;
    const wrapped: typeof fetch = async (input, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}') as { operationName?: string };
      if (body.operationName === 'ListLaikaChildren') listCount += 1;
      return mock.fetch(input, init);
    };

    const watchingRepo = new HygraphStorageRepository({
      endpoint: ENDPOINT,
      auth: { token: 'hygraph-test' },
      fetch: wrapped,
      serializerRegistry: {
        md: {
          format: { mediaType: 'text/markdown' } as never,
          serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
          deserializeDocumentFileContents: async raw => ({ body: raw }),
        },
      },
      defaultFileExtension: 'md',
    });

    const collected = await LaikaStream.runPromiseCollect(
      watchingRepo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(listCount).toBe(1);
    const byKey = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(byKey).toEqual({ notes: 'folder-summary', top: 'object-summary' });
  });

  it('sorts numeric filenames naturally', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '1', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '10', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '2', content: { body: 'c' } }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10']);
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

describe('HygraphStorageRepository folder semantics', () => {
  it('refuses to delete a non-empty folder (recoverable warning, not fatal)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'x' } }),
    );

    const attempt = await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes']));
    expect(attempt.data).toEqual([]);
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
    expect([...mock.folders.values()].some(f => f.path === 'notes')).toBe(true);
  });

  it('refuses to delete the storage root', async () => {
    const attempt = await LaikaStream.runPromiseCollect(makeRepo().removeAtoms(['']));
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
  });
});
