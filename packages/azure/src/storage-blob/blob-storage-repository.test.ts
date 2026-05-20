import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BlobEntry, BlobOps, BlobProperties } from './blob-datasource.js';
import { AzureBlobStorageRepository } from './blob-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory `BlobOps` — implements just enough to drive the repository.
// `listByHierarchy` reproduces Azure's hierarchy semantics: blobs whose name
// has further `/` after the prefix surface as common-prefix entries instead.
// ---------------------------------------------------------------------------

interface StoredBlob {
  content: string;
  contentType: string;
  lastModified: Date;
  etag: string;
}

const createMockOps = () => {
  const store = new Map<string, StoredBlob>();
  let etagCounter = 0;
  const newEtag = (): string => `"etag-${++etagCounter}"`;

  const ops: BlobOps = {
    async exists(name) {
      return store.has(name);
    },
    async getProperties(name): Promise<BlobProperties | null> {
      const blob = store.get(name);
      if (!blob) return null;
      return {
        contentLength: blob.content.length,
        lastModified: blob.lastModified,
        etag: blob.etag,
        contentType: blob.contentType,
      };
    },
    async download(name) {
      const blob = store.get(name);
      if (!blob) {
        const err = new Error('BlobNotFound');
        (err as { statusCode: number }).statusCode = 404;
        (err as { code: string }).code = 'BlobNotFound';
        throw err;
      }
      return blob.content;
    },
    async upload(name, content, contentType) {
      const blob: StoredBlob = {
        content,
        contentType,
        lastModified: new Date(),
        etag: newEtag(),
      };
      store.set(name, blob);
      return {
        contentLength: content.length,
        lastModified: blob.lastModified,
        etag: blob.etag,
        contentType,
      };
    },
    async delete(name) {
      store.delete(name);
    },
    async *listByHierarchy(prefix, delimiter): AsyncIterable<BlobEntry> {
      const seenPrefixes = new Set<string>();
      const blobEntries: BlobEntry[] = [];
      for (const blobName of store.keys()) {
        if (!blobName.startsWith(prefix)) continue;
        const remainder = blobName.slice(prefix.length);
        const delim = remainder.indexOf(delimiter);
        if (delim === -1) {
          blobEntries.push({ kind: 'blob', name: blobName });
        } else {
          const commonPrefix = prefix + remainder.slice(0, delim + 1);
          if (!seenPrefixes.has(commonPrefix)) {
            seenPrefixes.add(commonPrefix);
          }
        }
      }
      for (const entry of blobEntries) yield entry;
      for (const p of seenPrefixes) yield { kind: 'prefix', name: p };
    },
  };

  return { store, ops };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let mock: ReturnType<typeof createMockOps>;

beforeEach(() => { mock = createMockOps(); });
afterEach(() => { mock.store.clear(); });

const makeRepo = (basePath?: string) =>
  new AzureBlobStorageRepository({
    ops: mock.ops,
    basePath,
    serializerRegistry: {
      md: {
        format: { mediaType: 'text/markdown' } as never,
        serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
        deserializeDocumentFileContents: async raw => ({ body: raw }),
      },
    },
    defaultFileExtension: 'md',
  });

const seed = (name: string, content = '') => {
  mock.store.set(name, {
    content,
    contentType: 'text/markdown',
    lastModified: new Date('2026-05-01'),
    etag: `"seed-${name}"`,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AzureBlobStorageRepository listing', () => {
  it('sorts numeric filenames naturally', async () => {
    seed('1.md');
    seed('2.md');
    seed('10.md');
    seed('11.md');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10', '11']);
  });

  it('returns common-prefix children as folder-summary entries', async () => {
    seed('notes/a.md');
    seed('notes/b.md');
    seed('top.md');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    const byKey = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(byKey).toEqual({ notes: 'folder-summary', top: 'object-summary' });
  });

  it('honours basePath — blobs above the configured prefix are invisible', async () => {
    seed('content/hello.md');
    seed('content/notes/a.md');
    seed('other/ignored.md');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo('content').listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    const keys = collected.data.map(s => s.key).sort();
    expect(keys).toEqual(['hello', 'notes']);
  });
});

describe('AzureBlobStorageRepository CRUD round-trip', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    expect(created.metadata?.revisionId).toMatch(/etag-/);
    expect(mock.store.has('hello.md')).toBe(true);

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });
    expect(mock.store.get('hello.md')?.content).toBe('updated');
    expect(updated.metadata?.revisionId).not.toBe(created.metadata?.revisionId);

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect(mock.store.has('hello.md')).toBe(false);
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

  it('createFolder writes a .keep placeholder so the folder shows up', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));
    expect(mock.store.has('notes/.keep')).toBe(true);

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['notes']);
    expect(collected.data[0].type).toBe('folder-summary');
  });

  it('removing a non-existent key surfaces NotFoundError as a recoverable warning', async () => {
    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().removeAtoms(['does-not-exist']),
    );
    expect(collected.data).toEqual([]);
    expect(collected.done).toEqual({ removed: 0, skipped: 1 });
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('createObject auto-tolerates nested keys without folder markers', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c', content: { body: 'deep' } }),
    );
    // Azure (like S3) does not need explicit folder markers for nested writes.
    expect(mock.store.has('a/b/c.md')).toBe(true);
    expect(mock.store.has('a/.keep')).toBe(false);
    expect(mock.store.has('a/b/.keep')).toBe(false);
  });
});

describe('AzureBlobStorageRepository BlobOps abstraction', () => {
  it('accepts any BlobOps implementation — no SDK required for tests', () => {
    // The simple fact this test file constructs a repo from a plain object
    // satisfying BlobOps proves the abstraction works. Make it explicit.
    const fakeOps: BlobOps = {
      exists: async () => false,
      getProperties: async () => null,
      download: async () => '',
      upload: async () => ({ contentLength: 0, lastModified: new Date(), etag: '"x"' }),
      delete: async () => undefined,
      async *listByHierarchy() { /* yields nothing */ },
    };
    const repo = new AzureBlobStorageRepository({
      ops: fakeOps,
      serializerRegistry: {
        md: {
          format: { mediaType: 'text/markdown' } as never,
          serializeDocumentFileContents: async () => '',
          deserializeDocumentFileContents: async () => ({}),
        },
      },
      defaultFileExtension: 'md',
    });
    expect(repo).toBeInstanceOf(AzureBlobStorageRepository);
  });
});
