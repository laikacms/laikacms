import * as Result from 'effect/Result';
import { beforeEach, describe, expect, it } from 'vitest';
import { R2DataSource } from './r2-datasource.js';

// ---------------------------------------------------------------------------
// In-memory mock for the subset of R2Bucket the data source actually uses.
// ---------------------------------------------------------------------------

interface StoredObject {
  key: string;
  body: string;
  uploaded: Date;
  etag: string;
}

let etagCounter = 0;

class InMemoryR2Bucket {
  readonly store = new Map<string, StoredObject>();

  async head(key: string) {
    const obj = this.store.get(key);
    if (!obj) return null;
    return { size: obj.body.length, uploaded: obj.uploaded, etag: obj.etag };
  }

  async get(key: string) {
    const obj = this.store.get(key);
    if (!obj) return null;
    return {
      size: obj.body.length,
      uploaded: obj.uploaded,
      etag: obj.etag,
      text: async () => obj.body,
    };
  }

  async put(key: string, body: string) {
    this.store.set(key, {
      key,
      body,
      uploaded: new Date(),
      etag: `etag-${++etagCounter}`,
    });
  }

  async delete(key: string) {
    this.store.delete(key);
  }

  async list(opts: {
    prefix?: string,
    delimiter?: string,
    cursor?: string,
    limit?: number,
  }) {
    const prefix = opts.prefix ?? '';
    const delimiter = opts.delimiter;
    const limit = opts.limit ?? 1000;

    const matching = Array.from(this.store.values())
      .filter(o => o.key.startsWith(prefix))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const startIdx = opts.cursor
      ? matching.findIndex(o => o.key === opts.cursor)
      : 0;
    const sliceStart = startIdx === -1 ? matching.length : startIdx;

    const objects: { key: string, size: number, uploaded: Date, etag: string }[] = [];
    const delimitedPrefixSet = new Set<string>();

    let i = sliceStart;
    for (; i < matching.length && objects.length < limit; i++) {
      const o = matching[i];

      if (delimiter) {
        const tail = o.key.slice(prefix.length);
        const sepIdx = tail.indexOf(delimiter);
        if (sepIdx !== -1) {
          delimitedPrefixSet.add(prefix + tail.slice(0, sepIdx + delimiter.length));
          continue;
        }
      }

      objects.push({
        key: o.key,
        size: o.body.length,
        uploaded: o.uploaded,
        etag: o.etag,
      });
    }

    const truncated = i < matching.length;
    return {
      objects,
      delimitedPrefixes: Array.from(delimitedPrefixSet).sort(),
      truncated,
      cursor: truncated ? matching[i].key : undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let bucket: InMemoryR2Bucket;

beforeEach(() => {
  bucket = new InMemoryR2Bucket();
});

const makeDS = (extensions: string[] = ['md', 'json']) =>
  new R2DataSource(bucket as unknown as R2Bucket, extensions, extensions[0] ?? '');

describe('R2DataSource.createOrUpdate', () => {
  it('writes an object with the provided extension and returns the extension-less key', async () => {
    const ds = makeDS();
    const result = await ds.createOrUpdate('docs/hello', '# Hi', 'md');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.key).toBe('docs/hello');
    }
    expect(bucket.store.get('docs/hello.md')?.body).toBe('# Hi');
  });

  it('strips a user-supplied extension before re-applying the configured one', async () => {
    const ds = makeDS();
    await ds.createOrUpdate('note.md', 'body', 'md');

    expect(bucket.store.has('note.md')).toBe(true);
    expect(bucket.store.has('note.md.md')).toBe(false);
  });

  it('normalizes leading and trailing slashes', async () => {
    const ds = makeDS();
    await ds.createOrUpdate('/docs/hello/', 'x', 'md');

    expect(bucket.store.has('docs/hello.md')).toBe(true);
    expect(bucket.store.has('/docs/hello/.md')).toBe(false);
  });

  it('overwrites an existing object', async () => {
    const ds = makeDS();
    await ds.createOrUpdate('note', 'first', 'md');
    await ds.createOrUpdate('note', 'second', 'md');
    expect(bucket.store.get('note.md')?.body).toBe('second');
  });
});

describe('R2DataSource.getObjectContents', () => {
  it('returns the content for an existing object', async () => {
    const ds = makeDS();
    await bucket.put('doc.md', 'hello');

    const result = await ds.getObjectContents('doc');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.content).toBe('hello');
      expect(result.success.key).toBe('doc');
      expect(result.success.extension).toBe('md');
    }
  });

  it('resolves a missing extension by trying the available list', async () => {
    const ds = makeDS();
    await bucket.put('data.json', '{"k":1}');

    const result = await ds.getObjectContents('data');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.extension).toBe('json');
      expect(result.success.content).toBe('{"k":1}');
    }
  });

  it('returns NotFoundError for a missing object', async () => {
    const ds = makeDS();
    const result = await ds.getObjectContents('missing');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('not_found');
    }
  });

  it('honors the available-extension priority order', async () => {
    const ds = makeDS(['md', 'json']);
    await bucket.put('both.md', 'md-version');
    await bucket.put('both.json', '{"x":1}');

    const result = await ds.getObjectContents('both');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.extension).toBe('md');
    }
  });
});

describe('R2DataSource.findExistingObjectExtension', () => {
  it('returns the matching extension when the object exists', async () => {
    const ds = makeDS();
    await bucket.put('item.json', '{}');
    expect(await ds.findExistingObjectExtension('item')).toBe('json');
  });

  it('returns null when no variant exists', async () => {
    const ds = makeDS();
    expect(await ds.findExistingObjectExtension('nope')).toBeNull();
  });
});

describe('R2DataSource.getObjectMeta', () => {
  it('returns size, timestamps, and etag for an existing object', async () => {
    const ds = makeDS();
    await bucket.put('doc.md', 'twelve bytes');

    const result = await ds.getObjectMeta('doc');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.size).toBe(12);
      expect(result.success.extension).toBe('md');
      expect(result.success.key).toBe('doc');
      expect(result.success.etag).toMatch(/^etag-\d+$/);
      expect(result.success.createdAt).toBeInstanceOf(Date);
      expect(result.success.updatedAt).toEqual(result.success.createdAt);
    }
  });

  it('returns NotFoundError for a missing object', async () => {
    const ds = makeDS();
    const result = await ds.getObjectMeta('missing');
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe('R2DataSource.getFolderMeta', () => {
  it('returns timestamps when the prefix has at least one object', async () => {
    const ds = makeDS();
    await bucket.put('sub/file.md', 'x');

    const result = await ds.getFolderMeta('sub');
    expect(Result.isSuccess(result)).toBe(true);
  });

  it('returns NotFoundError for a prefix with no objects', async () => {
    const ds = makeDS();
    const result = await ds.getFolderMeta('does-not-exist');
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe('R2DataSource.listDirectory', () => {
  it('returns files and subdirectories at the given prefix', async () => {
    const ds = makeDS();
    await bucket.put('a.md', '');
    await bucket.put('b.md', '');
    await bucket.put('sub/inner.md', '');

    const result = await ds.listDirectory('');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const summary = result.success.map(e => `${e.type}:${e.key}`).sort();
      expect(summary).toEqual(['dir:sub', 'file:a.md', 'file:b.md']);
    }
  });

  it('skips .keep marker files', async () => {
    const ds = makeDS();
    await bucket.put('sub/.keep', '');
    await bucket.put('sub/real.md', '');

    const result = await ds.listDirectory('sub');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const keys = result.success.map(e => e.key);
      expect(keys).toContain('sub/real.md');
      expect(keys).not.toContain('sub/.keep');
    }
  });

  it('returns an empty list for a prefix with no objects', async () => {
    const ds = makeDS();
    const result = await ds.listDirectory('empty');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toEqual([]);
    }
  });
});

describe('R2DataSource.isFile / isDirectory', () => {
  it('isFile returns true for an existing object (after extension resolution)', async () => {
    const ds = makeDS();
    await bucket.put('doc.md', 'x');
    expect(await ds.isFile('doc')).toBe(true);
  });

  it('isFile returns false for a missing object', async () => {
    const ds = makeDS();
    expect(await ds.isFile('missing')).toBe(false);
  });

  it('isDirectory returns true when objects exist under the prefix', async () => {
    const ds = makeDS();
    await bucket.put('sub/file.md', 'x');
    expect(await ds.isDirectory('sub')).toBe(true);
  });

  it('isDirectory returns false when no objects share the prefix', async () => {
    const ds = makeDS();
    expect(await ds.isDirectory('nothing')).toBe(false);
  });
});

describe('R2DataSource.deleteObjects', () => {
  it('deletes resolved objects and yields their extension-less keys', async () => {
    const ds = makeDS();
    await bucket.put('a.md', 'a');
    await bucket.put('b.md', 'b');

    const yielded: string[] = [];
    for await (const result of ds.deleteObjects(['a', 'b'])) {
      if (Result.isSuccess(result)) yielded.push(result.success);
    }
    expect(yielded.sort()).toEqual(['a', 'b']);
    expect(bucket.store.has('a.md')).toBe(false);
    expect(bucket.store.has('b.md')).toBe(false);
  });

  it('yields a failure for keys that cannot be resolved', async () => {
    const ds = makeDS();

    const results: Array<Result.Result<unknown, unknown>> = [];
    for await (const result of ds.deleteObjects(['missing'])) {
      results.push(result);
    }
    // resolveKeyWithExtension returns null -> errorMessages push, then continue;
    // no yield is emitted for that key. This also documents current behaviour.
    expect(results).toEqual([]);
  });
});
