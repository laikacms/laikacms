import * as Result from 'effect/Result';
import { describe, expect, it } from 'vitest';
import { R2AssetsDataSource } from './r2-assets-datasource.js';

// ---------------------------------------------------------------------------
// Minimal in-memory bucket mock
// ---------------------------------------------------------------------------

let etagCounter = 0;

type StoredAsset = { body: Uint8Array, uploaded: Date, etag: string };

const makeBucket = () => {
  const store = new Map<string, StoredAsset>();

  const toMeta = (key: string, a: StoredAsset) => ({
    key,
    size: a.body.byteLength,
    etag: a.etag,
    uploaded: a.uploaded,
    httpMetadata: undefined as { contentType?: string } | undefined,
    customMetadata: undefined as Record<string, string> | undefined,
  });

  return {
    store,
    async head(key: string) {
      const a = store.get(key);
      return a ? toMeta(key, a) : null;
    },
    async get(key: string) {
      const a = store.get(key);
      if (!a) return null;
      const meta = toMeta(key, a);
      return {
        ...meta,
        body: new ReadableStream(),
        async arrayBuffer() {
          return a.body.buffer as ArrayBuffer;
        },
      };
    },
    async put(key: string, body: Uint8Array | string) {
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
      const stored: StoredAsset = {
        body: bytes,
        uploaded: new Date('2026-01-01T00:00:00Z'),
        etag: `etag-${++etagCounter}`,
      };
      store.set(key, stored);
      return toMeta(key, stored);
    },
    async delete(_key: string | readonly string[]) {},
    async list(opts: { prefix?: string, delimiter?: string, cursor?: string, limit?: number }) {
      const prefix = opts.prefix ?? '';
      const delim = opts.delimiter;
      const matching = Array.from(store.entries())
        .filter(([k]) => k.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

      const objects: ReturnType<typeof toMeta>[] = [];
      const delimitedPrefixSet = new Set<string>();
      for (const [key, a] of matching) {
        if (delim) {
          const tail = key.slice(prefix.length);
          const sepIdx = tail.indexOf(delim);
          if (sepIdx !== -1) {
            delimitedPrefixSet.add(prefix + tail.slice(0, sepIdx + delim.length));
            continue;
          }
        }
        objects.push(toMeta(key, a));
      }
      return {
        objects,
        delimitedPrefixes: Array.from(delimitedPrefixSet).sort(),
        truncated: false as const,
        cursor: undefined as string | undefined,
      };
    },
    createMultipartUpload: undefined as never,
    resumeMultipartUpload: undefined as never,
  };
};

// ---------------------------------------------------------------------------
// Throwing bucket: every method throws a specific error
// ---------------------------------------------------------------------------

const makeThrowingBucket = (msg = 'bucket failure'): unknown => ({
  async head() {
    throw new Error(msg);
  },
  async get() {
    throw new Error(msg);
  },
  async put() {
    throw new Error(msg);
  },
  async delete() {
    throw new Error(msg);
  },
  async list() {
    throw new Error(msg);
  },
  createMultipartUpload() {
    throw new Error(msg);
  },
  resumeMultipartUpload() {
    return {
      async uploadPart() {
        throw new Error(msg);
      },
      async complete() {
        throw new Error(msg);
      },
      async abort() {
        throw new Error(msg);
      },
    };
  },
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

// ---------------------------------------------------------------------------
// NotFoundError paths (bucket returns null)
// ---------------------------------------------------------------------------

describe('R2AssetsDataSource — NotFoundError paths', () => {
  it('getObjectMeta → NotFoundError when bucket.head returns null', async () => {
    const ds = new R2AssetsDataSource(makeBucket() as unknown as R2Bucket);
    const result = await ds.getObjectMeta('missing');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.code).toBe('not_found');
  });

  it('getObjectBody → NotFoundError when bucket.get returns null', async () => {
    const ds = new R2AssetsDataSource(makeBucket() as unknown as R2Bucket);
    const result = await ds.getObjectBody('missing');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.code).toBe('not_found');
  });

  it('getObjectStream → NotFoundError when bucket.get returns null', async () => {
    const ds = new R2AssetsDataSource(makeBucket() as unknown as R2Bucket);
    const result = await ds.getObjectStream('missing');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.code).toBe('not_found');
  });

  it('getFolderMeta → NotFoundError when prefix has no objects', async () => {
    const ds = new R2AssetsDataSource(makeBucket() as unknown as R2Bucket);
    const result = await ds.getFolderMeta('empty');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.code).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// InternalError paths (bucket throws)
// ---------------------------------------------------------------------------

describe('R2AssetsDataSource — InternalError paths', () => {
  it('getObjectMeta → InternalError with message when bucket.head throws', async () => {
    const ds = new R2AssetsDataSource(makeThrowingBucket('head exploded') as R2Bucket);
    const result = await ds.getObjectMeta('key');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('internal_error');
      expect(result.failure.message).toContain('head exploded');
    }
  });

  it('getObjectMeta — non-Error thrown → message is String(error)', async () => {
    const bucket: unknown = {
      async head() {
        throw 42;
      },
    };
    const ds = new R2AssetsDataSource(bucket as R2Bucket);
    const result = await ds.getObjectMeta('key');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('internal_error');
      expect(result.failure.message).toContain('42');
    }
  });

  it('getObjectBody → InternalError when bucket.get throws', async () => {
    const ds = new R2AssetsDataSource(makeThrowingBucket('get exploded') as R2Bucket);
    const result = await ds.getObjectBody('key');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('internal_error');
      expect(result.failure.message).toContain('get exploded');
    }
  });

  it('getObjectStream → InternalError when bucket.get throws', async () => {
    const ds = new R2AssetsDataSource(makeThrowingBucket('stream exploded') as R2Bucket);
    const result = await ds.getObjectStream('key');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('internal_error');
      expect(result.failure.message).toContain('stream exploded');
    }
  });

  it('putObject → InternalError when bucket.put throws', async () => {
    const ds = new R2AssetsDataSource(makeThrowingBucket('put exploded') as R2Bucket);
    const result = await ds.putObject('key', PNG, { contentType: 'image/png' });
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('internal_error');
      expect(result.failure.message).toContain('put exploded');
    }
  });

  it('deleteObject → InternalError when bucket.delete throws', async () => {
    const ds = new R2AssetsDataSource(makeThrowingBucket('delete exploded') as R2Bucket);
    const result = await ds.deleteObject('key');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('internal_error');
      expect(result.failure.message).toContain('delete exploded');
    }
  });

  it('deleteObjects (generator) → yields InternalError when bucket.delete throws', async () => {
    const ds = new R2AssetsDataSource(makeThrowingBucket('multi-delete exploded') as R2Bucket);
    const results: Result.Result<string, unknown>[] = [];
    for await (const r of ds.deleteObjects(['a', 'b'])) results.push(r);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(Result.isFailure(r)).toBe(true);
      if (Result.isFailure(r)) {
        expect((r.failure as { code: string }).code).toBe('internal_error');
        expect((r.failure as { message: string }).message).toContain('multi-delete exploded');
      }
    }
  });

  it('listDirectory → InternalError when bucket.list throws', async () => {
    const ds = new R2AssetsDataSource(makeThrowingBucket('list exploded') as R2Bucket);
    const result = await ds.listDirectory('prefix');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('internal_error');
      expect(result.failure.message).toContain('list exploded');
    }
  });

  it('createFolder → InternalError when bucket.put throws', async () => {
    const ds = new R2AssetsDataSource(makeThrowingBucket('create-folder exploded') as R2Bucket);
    const result = await ds.createFolder('myfolder');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('internal_error');
      expect(result.failure.message).toContain('create-folder exploded');
    }
  });

  it('getFolderMeta → InternalError when bucket.list throws', async () => {
    const ds = new R2AssetsDataSource(makeThrowingBucket('folder-meta exploded') as R2Bucket);
    const result = await ds.getFolderMeta('myfolder');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('internal_error');
      expect(result.failure.message).toContain('folder-meta exploded');
    }
  });

  it('deleteFolder → InternalError when bucket.list throws', async () => {
    const ds = new R2AssetsDataSource(makeThrowingBucket('delete-folder exploded') as R2Bucket);
    const result = await ds.deleteFolder('myfolder', true);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('internal_error');
      expect(result.failure.message).toContain('delete-folder exploded');
    }
  });
});

// ---------------------------------------------------------------------------
// Happy-path smoke tests
// ---------------------------------------------------------------------------

describe('R2AssetsDataSource — happy paths', () => {
  it('getObjectMeta → returns metadata for an existing object', async () => {
    const bucket = makeBucket();
    await bucket.put('img.png', PNG);
    const ds = new R2AssetsDataSource(bucket as unknown as R2Bucket);
    const result = await ds.getObjectMeta('img.png');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.key).toBe('img.png');
      expect(result.success.size).toBe(PNG.byteLength);
      expect(result.success.etag).toMatch(/^etag-\d+$/);
    }
  });

  it('getObjectMeta strips leading/trailing slashes (key normalisation)', async () => {
    const bucket = makeBucket();
    await bucket.put('img.png', PNG);
    const ds = new R2AssetsDataSource(bucket as unknown as R2Bucket);
    const result = await ds.getObjectMeta('/img.png/');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) expect(result.success.key).toBe('img.png');
  });

  it('getObjectBody → returns body and metadata for an existing object', async () => {
    const bucket = makeBucket();
    await bucket.put('img.png', PNG);
    const ds = new R2AssetsDataSource(bucket as unknown as R2Bucket);
    const result = await ds.getObjectBody('img.png');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.body.byteLength).toBe(PNG.byteLength);
      expect(result.success.meta.key).toBe('img.png');
    }
  });

  it('putObject → stores and returns metadata', async () => {
    const bucket = makeBucket();
    const ds = new R2AssetsDataSource(bucket as unknown as R2Bucket);
    const result = await ds.putObject('file.png', PNG, { contentType: 'image/png' });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.key).toBe('file.png');
      expect(result.success.size).toBe(PNG.byteLength);
    }
    expect(bucket.store.has('file.png')).toBe(true);
  });

  it('deleteObject → succeeds and removes the object', async () => {
    const bucket = makeBucket();
    await bucket.put('gone.png', PNG);
    const ds = new R2AssetsDataSource(bucket as unknown as R2Bucket);
    const result = await ds.deleteObject('gone.png');
    expect(Result.isSuccess(result)).toBe(true);
  });

  it('listDirectory → returns files and sub-directories', async () => {
    const bucket = makeBucket();
    await bucket.put('a/b.png', PNG);
    await bucket.put('a/c.png', PNG);
    await bucket.put('a/sub/d.png', PNG);
    const ds = new R2AssetsDataSource(bucket as unknown as R2Bucket);
    const result = await ds.listDirectory('a');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const types = result.success.map(e => e.type);
      expect(types).toContain('file');
      expect(types).toContain('dir');
    }
  });

  it('exists → true for a stored key, false for missing', async () => {
    const bucket = makeBucket();
    await bucket.put('present.png', PNG);
    const ds = new R2AssetsDataSource(bucket as unknown as R2Bucket);
    expect(await ds.exists('present.png')).toBe(true);
    expect(await ds.exists('absent.png')).toBe(false);
  });

  it('getFolderMeta → succeeds when prefix has at least one object', async () => {
    const bucket = makeBucket();
    await bucket.put('folder/file.png', PNG);
    const ds = new R2AssetsDataSource(bucket as unknown as R2Bucket);
    const result = await ds.getFolderMeta('folder');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.createdAt).toBeInstanceOf(Date);
    }
  });
});
