import * as Result from 'effect/Result';
import { describe, expect, it } from 'vitest';

import { InMemoryWebStorage } from '../../testing.js';
import { WebStorageDataSource } from './web-storage-datasource.js';

const makeDataSource = (storage: Storage, namespace = 'laikacms', extensions = ['json', 'md']) =>
  new WebStorageDataSource(() => storage, namespace, extensions);

describe('WebStorageDataSource.createOrUpdate', () => {
  it('writes an object under the namespaced physical key and returns the extension-less key', async () => {
    const storage = new InMemoryWebStorage();
    const ds = makeDataSource(storage);

    const result = await ds.createOrUpdate('docs/hello', '{"a":1}', 'json');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.key).toBe('docs/hello');
    }
    expect(storage.getItem('laikacms:docs/hello.json')).not.toBeNull();
  });

  it('maps a QuotaExceededError-like setItem failure to the typed domain error', async () => {
    const storage = new InMemoryWebStorage();
    storage.setItem = () => {
      const err = new Error('The quota has been exceeded.');
      err.name = 'QuotaExceededError';
      throw err;
    };
    const ds = makeDataSource(storage);

    const result = await ds.createOrUpdate('too-big', 'x'.repeat(10), 'json');

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('quota_exceeded');
    }
  });
});

describe('WebStorageDataSource.getObjectContents', () => {
  it('reads back an object written via createOrUpdate', async () => {
    const storage = new InMemoryWebStorage();
    const ds = makeDataSource(storage);
    await ds.createOrUpdate('doc', 'hello', 'json');

    const result = await ds.getObjectContents('doc');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.content).toBe('hello');
      expect(result.success.key).toBe('doc');
      expect(result.success.extension).toBe('json');
    }
  });

  it('returns NotFoundError for a missing object', async () => {
    const storage = new InMemoryWebStorage();
    const ds = makeDataSource(storage);

    const result = await ds.getObjectContents('missing');

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('not_found');
    }
  });

  it('maps a getItem failure to InternalError', async () => {
    const storage = new InMemoryWebStorage();
    storage.getItem = () => {
      throw new Error('boom');
    };
    const ds = makeDataSource(storage);

    const result = await ds.getObjectContents('anything');

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('internal_error');
    }
  });
});

describe('WebStorageDataSource.getObjectMeta', () => {
  it('returns createdAt/updatedAt for an existing object', async () => {
    const storage = new InMemoryWebStorage();
    const ds = makeDataSource(storage);
    await ds.createOrUpdate('doc', 'v1', 'json');

    const result = await ds.getObjectMeta('doc');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.createdAt).toBeInstanceOf(Date);
      expect(result.success.updatedAt).toBeInstanceOf(Date);
      expect(result.success.key).toBe('doc');
      expect(result.success.extension).toBe('json');
    }
  });

  it('returns NotFoundError for a missing object', async () => {
    const storage = new InMemoryWebStorage();
    const ds = makeDataSource(storage);

    const result = await ds.getObjectMeta('missing');

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('not_found');
    }
  });
});

describe('WebStorageDataSource.getFolderMeta', () => {
  it('returns synthesized timestamps when child entries exist', async () => {
    const storage = new InMemoryWebStorage();
    const ds = makeDataSource(storage);
    await ds.createOrUpdate('folder/child', 'x', 'json');

    const result = await ds.getFolderMeta('folder');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.createdAt).toBeInstanceOf(Date);
      expect(result.success.updatedAt).toBeInstanceOf(Date);
    }
  });

  it('returns NotFoundError when no entries exist under the prefix', async () => {
    const storage = new InMemoryWebStorage();
    const ds = makeDataSource(storage);

    const result = await ds.getFolderMeta('nope');

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('not_found');
    }
  });
});

describe('WebStorageDataSource.listDirectory', () => {
  it('lists immediate files and subdirectories, skipping the .keep marker', async () => {
    const storage = new InMemoryWebStorage();
    const ds = makeDataSource(storage);
    await ds.createOrUpdate('dir/a', 'x', 'json');
    await ds.createOrUpdate('dir/sub/b', 'y', 'json');
    await ds.createOrUpdate('dir/.keep', '', '');

    const result = await ds.listDirectory('dir');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const entries = result.success.map(e => `${e.type}:${e.key}`).sort();
      expect(entries).toEqual(['dir:dir/sub', 'file:dir/a.json']);
    }
  });

  it('returns NotFoundError when the prefix has no entries at all', async () => {
    const storage = new InMemoryWebStorage();
    const ds = makeDataSource(storage);

    const result = await ds.listDirectory('missing');

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('not_found');
    }
  });

  it('namespaces listings so unrelated Storage keys never leak into the result', async () => {
    const storage = new InMemoryWebStorage();
    storage.setItem('other-app:dir/secret.json', JSON.stringify({ body: '{}', createdAt: '', updatedAt: '' }));
    const ds = makeDataSource(storage);
    await ds.createOrUpdate('dir/mine', 'x', 'json');

    const result = await ds.listDirectory('dir');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.map(e => e.key)).toEqual(['dir/mine.json']);
    }
  });
});

describe('WebStorageDataSource.deleteObjects', () => {
  it('deletes existing objects and yields their logical keys', async () => {
    const storage = new InMemoryWebStorage();
    const ds = makeDataSource(storage);
    await ds.createOrUpdate('a', 'x', 'json');
    await ds.createOrUpdate('b', 'y', 'json');

    const results: Array<Result.Result<string, unknown>> = [];
    for await (const r of ds.deleteObjects(['a', 'b'])) results.push(r);

    expect(results).toHaveLength(2);
    expect(results.every(Result.isSuccess)).toBe(true);
    expect(storage.getItem('laikacms:a.json')).toBeNull();
    expect(storage.getItem('laikacms:b.json')).toBeNull();
  });

  it('yields NotFoundError for a key that does not exist, without stopping the generator', async () => {
    const storage = new InMemoryWebStorage();
    const ds = makeDataSource(storage);
    await ds.createOrUpdate('exists', 'x', 'json');

    const results: Array<Result.Result<string, { code: string }>> = [];
    for await (const r of ds.deleteObjects(['missing', 'exists'])) {
      results.push(r as Result.Result<string, { code: string }>);
    }

    expect(results).toHaveLength(2);
    expect(Result.isFailure(results[0])).toBe(true);
    if (Result.isFailure(results[0])) expect(results[0].failure.code).toBe('not_found');
    expect(Result.isSuccess(results[1])).toBe(true);
  });

  it('maps a removeItem failure to InternalError for that key', async () => {
    const storage = new InMemoryWebStorage();
    const ds = makeDataSource(storage);
    await ds.createOrUpdate('doomed', 'x', 'json');
    storage.removeItem = () => {
      throw new Error('boom');
    };

    const results: Array<Result.Result<string, { code: string }>> = [];
    for await (const r of ds.deleteObjects(['doomed'])) {
      results.push(r as Result.Result<string, { code: string }>);
    }

    expect(results).toHaveLength(1);
    expect(Result.isFailure(results[0])).toBe(true);
    if (Result.isFailure(results[0])) expect(results[0].failure.code).toBe('internal_error');
  });
});

describe('WebStorageDataSource.findExistingObjectExtension', () => {
  it('returns the matching extension when the object exists', async () => {
    const storage = new InMemoryWebStorage();
    const ds = makeDataSource(storage);
    await ds.createOrUpdate('item', '{}', 'json');

    expect(await ds.findExistingObjectExtension('item')).toBe('json');
  });

  it('returns null when no variant exists', async () => {
    const storage = new InMemoryWebStorage();
    const ds = makeDataSource(storage);

    expect(await ds.findExistingObjectExtension('nope')).toBeNull();
  });

  it('returns null (never throws) when the underlying storage access fails', async () => {
    const storage = new InMemoryWebStorage();
    storage.getItem = () => {
      throw new Error('boom');
    };
    const ds = makeDataSource(storage);

    expect(await ds.findExistingObjectExtension('anything')).toBeNull();
  });
});

describe('WebStorageDataSource namespace isolation', () => {
  it("two datasources sharing one Storage under different namespaces never see each other's keys", async () => {
    const shared = new InMemoryWebStorage();
    const dsA = makeDataSource(shared, 'app-a');
    const dsB = makeDataSource(shared, 'app-b');

    await dsA.createOrUpdate('shared-key', 'from-a', 'json');
    await dsB.createOrUpdate('shared-key', 'from-b', 'json');

    const fromA = await dsA.getObjectContents('shared-key');
    const fromB = await dsB.getObjectContents('shared-key');
    expect(Result.isSuccess(fromA) && fromA.success.content).toBe('from-a');
    expect(Result.isSuccess(fromB) && fromB.success.content).toBe('from-b');
  });
});
