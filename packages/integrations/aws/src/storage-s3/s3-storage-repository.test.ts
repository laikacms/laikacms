import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { runStorageRepositoryContract } from 'laikacms/storage/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { S3StorageRepository } from './s3-storage-repository.js';
import { s3ContractCase } from './testing/index.js';

runStorageRepositoryContract(s3ContractCase);

// ---------------------------------------------------------------------------
// Wire the official aws-sdk-client-mock to an in-memory Map so the repository
// can be exercised end-to-end against realistic S3 semantics (delimiter `/`,
// CommonPrefixes, 404 from HEAD, paginated ListObjectsV2).
// ---------------------------------------------------------------------------

interface StoredObject {
  body: string;
  contentType?: string;
  lastModified: Date;
  etag: string;
}

const BUCKET = 'test-bucket';

const stringBody = (body: string) => ({
  transformToString: async () => body,
});

const notFoundError = () => {
  const err = new Error('NoSuchKey');
  (err as { name: string }).name = 'NoSuchKey';
  (err as { $metadata: unknown }).$metadata = { httpStatusCode: 404 };
  return err;
};

const setupMock = () => {
  const store = new Map<string, StoredObject>();
  let etagCounter = 0;
  const s3 = mockClient(S3Client);

  s3.on(HeadObjectCommand).callsFake(input => {
    const obj = store.get(input.Key);
    if (!obj) throw notFoundError();
    return {
      ContentLength: obj.body.length,
      LastModified: obj.lastModified,
      ETag: obj.etag,
      ContentType: obj.contentType,
    };
  });

  s3.on(GetObjectCommand).callsFake(input => {
    const obj = store.get(input.Key);
    if (!obj) throw notFoundError();
    return {
      Body: stringBody(obj.body),
      LastModified: obj.lastModified,
      ETag: obj.etag,
      ContentLength: obj.body.length,
    };
  });

  s3.on(PutObjectCommand).callsFake(input => {
    etagCounter += 1;
    store.set(input.Key, {
      body: typeof input.Body === 'string' ? input.Body : '',
      contentType: input.ContentType,
      lastModified: new Date(),
      etag: `etag-${etagCounter}`,
    });
    return { ETag: `etag-${etagCounter}` };
  });

  s3.on(DeleteObjectCommand).callsFake(input => {
    store.delete(input.Key);
    return {};
  });

  s3.on(ListObjectsV2Command).callsFake(input => {
    const prefix = input.Prefix ?? '';
    const delimiter = input.Delimiter;
    const maxKeys = input.MaxKeys ?? 1000;

    const contents: Array<{ Key: string, LastModified: Date, Size: number, ETag: string }> = [];
    const commonPrefixSet = new Set<string>();

    for (const [key, obj] of store) {
      if (!key.startsWith(prefix)) continue;
      const remainder = key.slice(prefix.length);
      if (delimiter && remainder.includes(delimiter)) {
        const idx = remainder.indexOf(delimiter);
        commonPrefixSet.add(prefix + remainder.slice(0, idx + delimiter.length));
        continue;
      }
      contents.push({ Key: key, LastModified: obj.lastModified, Size: obj.body.length, ETag: obj.etag });
    }

    return {
      Contents: contents.slice(0, maxKeys),
      CommonPrefixes: [...commonPrefixSet].map(p => ({ Prefix: p })),
      IsTruncated: false,
      KeyCount: contents.length + commonPrefixSet.size,
    };
  });

  return { s3, store };
};

let ctx: ReturnType<typeof setupMock>;

beforeEach(() => {
  ctx = setupMock();
});
afterEach(() => {
  ctx.s3.restore();
  ctx.store.clear();
});

const makeRepo = (basePath?: string) =>
  new S3StorageRepository({
    client: new S3Client({ region: 'us-east-1' }),
    bucket: BUCKET,
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

const seed = (key: string, body = '') => {
  ctx.store.set(key, { body, lastModified: new Date('2026-05-01'), etag: `seed-${key}` });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('S3StorageRepository listing', () => {
  it('sorts numeric filenames naturally (2 before 10)', async () => {
    seed('1.md');
    seed('2.md');
    seed('10.md');
    seed('11.md');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10', '11']);
  });

  it('returns folders as folder-summary entries and files as object-summary', async () => {
    seed('notes/a.md');
    seed('notes/b.md');
    seed('top.md');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    const byKey = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(byKey).toEqual({ notes: 'folder-summary', top: 'object-summary' });
  });

  it('honours basePath — nothing leaks above the configured prefix', async () => {
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

describe('S3StorageRepository CRUD round-trip', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    expect(created.metadata?.revisionId).toMatch(/^etag-/);
    expect(ctx.store.has('hello.md')).toBe(true);

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });
    expect(ctx.store.get('hello.md')?.body).toBe('updated');

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect(ctx.store.has('hello.md')).toBe(false);
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

  it('createFolder writes a .keep so the folder shows up in listings', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));
    expect(ctx.store.has('notes/.keep')).toBe(true);

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
});
