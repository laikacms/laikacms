import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { runStorageRepositoryContract } from 'laikacms/storage/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type FirestoreFields, toFirestoreFields } from './firestore-datasource.js';
import { FirestoreStorageRepository } from './firestore-storage-repository.js';
import { firestoreContractCase } from './testing/index.js';

runStorageRepositoryContract(firestoreContractCase);

// ---------------------------------------------------------------------------
// In-memory Firestore — handles GET / PATCH / DELETE / collection-list for
// the alternating-collection/document path scheme the repository emits.
// ---------------------------------------------------------------------------

const PROJECT = 'demo-project';
const DB = '(default)';
const API_URL = 'https://mock.firestore.test/v1';

interface StoredDoc {
  fields: FirestoreFields;
  createTime: string;
  updateTime: string;
}

const createMockFirestore = () => {
  /** Path → document map. Path is the wire path under `documents/`. */
  const docs = new Map<string, StoredDoc>();

  const fullName = (path: string) => `projects/${PROJECT}/databases/${DB}/documents/${path}`;

  const json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } });

  const stripPrefix = (pathname: string): string | null => {
    const prefix = `/v1/projects/${PROJECT}/databases/${encodeURIComponent(DB)}/documents/`;
    if (!pathname.startsWith(prefix)) return null;
    return pathname.slice(prefix.length);
  };

  const isCollectionPath = (path: string): boolean => {
    // Document paths have an *odd* number of segments; collection paths have
    // an *even* number. (Both alternate but start on different sides.)
    return path.split('/').length % 2 === 1;
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const path = stripPrefix(url.pathname);
    if (path === null) return new Response('{"error":"bad route"}', { status: 404 });
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'GET' && isCollectionPath(path)) {
      const documents: Array<{ name: string, fields: FirestoreFields, createTime: string, updateTime: string }> = [];
      for (const [docPath, doc] of docs) {
        // direct children of `path`: docPath must have exactly two more segments
        if (!docPath.startsWith(`${path}/`)) continue;
        const remainder = docPath.slice(path.length + 1);
        if (remainder.split('/').length !== 1) continue;
        documents.push({
          name: fullName(docPath),
          fields: doc.fields,
          createTime: doc.createTime,
          updateTime: doc.updateTime,
        });
      }
      return json({ documents });
    }

    if (method === 'GET') {
      const doc = docs.get(path);
      if (!doc) return json({ error: { message: 'NOT_FOUND' } }, { status: 404 });
      return json({ name: fullName(path), fields: doc.fields, createTime: doc.createTime, updateTime: doc.updateTime });
    }
    if (method === 'PATCH') {
      const body = JSON.parse((init?.body as string) ?? '{}') as { fields?: FirestoreFields };
      const now = new Date().toISOString();
      const existing = docs.get(path);
      docs.set(path, {
        fields: body.fields ?? {},
        createTime: existing?.createTime ?? now,
        updateTime: now,
      });
      return json({
        name: fullName(path),
        fields: body.fields ?? {},
        createTime: existing?.createTime ?? now,
        updateTime: now,
      });
    }
    if (method === 'DELETE') {
      docs.delete(path);
      return json({});
    }
    return new Response(`{"unhandled":"${method} ${url.pathname}"}`, { status: 501 });
  };

  return { docs, fetch: fetchImpl };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let mock: ReturnType<typeof createMockFirestore>;

beforeEach(() => {
  mock = createMockFirestore();
});
afterEach(() => {
  mock.docs.clear();
});

const makeRepo = () =>
  new FirestoreStorageRepository({
    auth: { accessToken: 'ya29.fake' },
    projectId: PROJECT,
    apiUrl: API_URL,
    fetch: mock.fetch,
    rootCollection: 'laika',
    itemsCollection: 'items',
    serializerRegistry: {
      md: {
        format: { mediaType: 'text/markdown' } as never,
        serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
        deserializeDocumentFileContents: async raw => ({ body: raw }),
      },
    },
    defaultFileExtension: 'md',
  });

const seed = (path: string, fields: Record<string, unknown>) => {
  const now = new Date('2026-05-01').toISOString();
  mock.docs.set(path, { fields: toFirestoreFields(fields), createTime: now, updateTime: now });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FirestoreStorageRepository CRUD', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    expect(mock.docs.has('laika/hello.md')).toBe(true);

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect(mock.docs.has('laika/hello.md')).toBe(false);
  });

  it('uses alternating collection/document paths for nested keys', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c', content: { body: 'deep' } }),
    );

    // Folder markers for a and a/b
    expect(mock.docs.has('laika/a')).toBe(true);
    expect(mock.docs.has('laika/a/items/b')).toBe(true);
    // The leaf file under the alternating subcollection scheme
    expect(mock.docs.has('laika/a/items/b/items/c.md')).toBe(true);
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

  it('rejects keys with characters outside `^[A-Za-z0-9._-]+$`', async () => {
    const repo = makeRepo();
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'has spaces', content: { body: 'x' } }),
      ),
    ).rejects.toThrow(/letters, digits, hyphens, underscores/i);
  });
});

describe('FirestoreStorageRepository listing', () => {
  it('classifies file documents as object-summary and folder markers as folder-summary', async () => {
    seed('laika/notes', { _type: 'folder' });
    seed('laika/notes/items/a.md', { _type: 'file', _extension: 'md', _content: 'a' });
    seed('laika/top.md', { _type: 'file', _extension: 'md', _content: 't' });

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    const byKey = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(byKey).toEqual({ notes: 'folder-summary', top: 'object-summary' });
  });

  it('sorts numeric filenames naturally', async () => {
    seed('laika/1.md', { _type: 'file', _extension: 'md', _content: 'a' });
    seed('laika/2.md', { _type: 'file', _extension: 'md', _content: 'b' });
    seed('laika/10.md', { _type: 'file', _extension: 'md', _content: 'c' });
    seed('laika/11.md', { _type: 'file', _extension: 'md', _content: 'd' });

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10', '11']);
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

describe('FirestoreStorageRepository folder semantics', () => {
  it('createFolder writes a folder marker document at the requested path', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));

    expect(mock.docs.has('laika/notes')).toBe(true);
    const fields = mock.docs.get('laika/notes')?.fields;
    expect(fields?.['_type']).toEqual({ stringValue: 'folder' });
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
    expect(mock.docs.has('laika/notes')).toBe(true);
  });

  it('refuses to delete the storage root', async () => {
    const attempt = await LaikaStream.runPromiseCollect(makeRepo().removeAtoms(['']));
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
  });
});
