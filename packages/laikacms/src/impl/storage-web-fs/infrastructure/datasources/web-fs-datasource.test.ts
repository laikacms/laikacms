import * as Result from 'effect/Result';
import {
  DirInsteadOfFile,
  FileInsteadOfDir,
  ForbiddenError,
  IllegalStateException,
  InvalidData,
  PermissionDeniedError,
  PermissionPromptRequiredError,
  QuotaExceededError,
  StaleHandleError,
} from 'laikacms/core';

import { describe, expect, it } from 'vitest';

import type { WebFsFileHandle } from '../../domain/types/web-fs-handles.js';
import { InMemoryPickedDirectoryHandle, InMemoryWebFsDirectoryHandle } from '../../testing.js';
import { WebFsDataSource } from './web-fs-datasource.js';

const makeDs = (
  root: InMemoryWebFsDirectoryHandle,
  namespace = '',
  availableExtensions: string[] = ['json'],
) => new WebFsDataSource(async () => root, namespace, availableExtensions);

describe('WebFsDataSource.createOrUpdate + getObjectContents', () => {
  it('writes an object and reads it back with the configured extension', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    const write = await ds.createOrUpdate('docs/hello', '{"a":1}', 'json');
    expect(Result.isSuccess(write)).toBe(true);
    if (Result.isSuccess(write)) expect(write.success.key).toBe('docs/hello');

    const read = await ds.getObjectContents('docs/hello');
    expect(Result.isSuccess(read)).toBe(true);
    if (Result.isSuccess(read)) {
      expect(read.success.content).toBe('{"a":1}');
      expect(read.success.key).toBe('docs/hello');
      expect(read.success.extension).toBe('json');
    }
  });

  it('overwrites an existing object in place', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    await ds.createOrUpdate('note', 'first', 'json');
    await ds.createOrUpdate('note', 'second', 'json');

    const read = await ds.getObjectContents('note');
    expect(Result.isSuccess(read) && read.success.content).toBe('second');
  });

  it('rejects an empty key with InvalidData', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    const result = await ds.createOrUpdate('', 'x', 'json');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(InvalidData);
  });

  it('rejects a traversal key with InvalidData', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    const result = await ds.createOrUpdate('a/../../escape', 'x', 'json');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(InvalidData);
  });

  it('returns NotFoundError when reading an object that was never written', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    const result = await ds.getObjectContents('missing');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.code).toBe('not_found');
  });

  it('maps a directory occupying the target physical name to DirInsteadOfFile', async () => {
    // Extension '' makes the physical name equal the logical key, so the
    // folder and object collide on the same on-disk name.
    const ds = makeDs(new InMemoryWebFsDirectoryHandle(), '', ['']);
    await ds.createFolder('foo');
    const result = await ds.createOrUpdate('foo', 'x', '');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(DirInsteadOfFile);
  });

  it('maps a QuotaExceededError DOMException from createWritable to the typed domain error', async () => {
    class QuotaExceededRoot extends InMemoryWebFsDirectoryHandle {
      override async getFileHandle(name: string, options?: { create?: boolean }): Promise<WebFsFileHandle> {
        const handle = await super.getFileHandle(name, options);
        return {
          kind: 'file',
          name,
          getFile: () => handle.getFile(),
          createWritable: async () => {
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
          },
        };
      }
    }
    const ds = makeDs(new QuotaExceededRoot());
    const result = await ds.createOrUpdate('too-big', 'x'.repeat(10), 'json');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(QuotaExceededError);
  });

  it('maps a NotAllowedError DOMException mid-write to PermissionDeniedError', async () => {
    class RevokedMidWriteRoot extends InMemoryWebFsDirectoryHandle {
      override async getFileHandle(): Promise<WebFsFileHandle> {
        throw new DOMException('User activation is required', 'NotAllowedError');
      }
    }
    const ds = makeDs(new RevokedMidWriteRoot());
    const result = await ds.createOrUpdate('doc', 'x', 'json');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(PermissionDeniedError);
  });

  it('maps an unrecognized error to InternalError via the default branch', async () => {
    class BrokenRoot extends InMemoryWebFsDirectoryHandle {
      override async getFileHandle(): Promise<WebFsFileHandle> {
        throw new Error('disk on fire');
      }
    }
    const ds = makeDs(new BrokenRoot());
    const result = await ds.createOrUpdate('doc', 'x', 'json');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.code).toBe('internal_error');
  });
});

describe('WebFsDataSource.findExistingObjectExtension', () => {
  it('returns the matching extension when the object exists', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle(), '', ['md', 'json']);
    await ds.createOrUpdate('item', '{}', 'json');
    expect(await ds.findExistingObjectExtension('item')).toBe('json');
  });

  it('returns null when no variant exists', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle(), '', ['md', 'json']);
    expect(await ds.findExistingObjectExtension('nope')).toBeNull();
  });

  it('returns null (never throws) for a traversal key', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    expect(await ds.findExistingObjectExtension('../escape')).toBeNull();
  });
});

describe('WebFsDataSource.getObjectMeta', () => {
  it('returns timestamps and key for an existing object', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    await ds.createOrUpdate('doc', 'twelve bytes', 'json');

    const result = await ds.getObjectMeta('doc');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.key).toBe('doc');
      expect(result.success.extension).toBe('json');
      expect(result.success.createdAt).toBeInstanceOf(Date);
      expect(result.success.updatedAt).toBeInstanceOf(Date);
    }
  });

  it('returns NotFoundError for a missing object', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    const result = await ds.getObjectMeta('missing');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.code).toBe('not_found');
  });
});

describe('WebFsDataSource.getFolderMeta', () => {
  it('returns synthesized timestamps for an existing folder', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    await ds.createFolder('articles/drafts');

    const result = await ds.getFolderMeta('articles/drafts');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.createdAt).toBeInstanceOf(Date);
      expect(result.success.updatedAt).toBeInstanceOf(Date);
    }
  });

  it('returns NotFoundError for a missing folder', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    const result = await ds.getFolderMeta('nope');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.code).toBe('not_found');
  });
});

describe('WebFsDataSource.listDirectory', () => {
  it('lists immediate children as WebFsEntry objects, one level deep', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    await ds.createFolder('rev/sub');
    await ds.createOrUpdate('rev/a', '{}', 'json');
    await ds.createOrUpdate('rev/b', '{}', 'json');

    const result = await ds.listDirectory('rev');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const entries = result.success.map(e => `${e.type}:${e.key}`).sort();
      expect(entries).toEqual(['dir:rev/sub', 'file:rev/a.json', 'file:rev/b.json']);
    }
  });

  it('returns an empty array for an existing empty folder', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    await ds.createFolder('empty');

    const result = await ds.listDirectory('empty');
    expect(Result.isSuccess(result) && result.success).toEqual([]);
  });

  it('returns NotFoundError for a folder that was never created', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    const result = await ds.listDirectory('does-not-exist');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.code).toBe('not_found');
  });
});

describe('WebFsDataSource.createFolder', () => {
  it('creates an empty directory chain', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    const result = await ds.createFolder('a/b/c');
    expect(Result.isSuccess(result)).toBe(true);

    const listed = await ds.listDirectory('a/b');
    expect(Result.isSuccess(listed) && listed.success).toEqual([{ type: 'dir', key: 'a/b/c' }]);
  });

  it('maps a file occupying an intermediate segment to FileInsteadOfDir', async () => {
    // Extension '' makes the physical name equal the logical key, so walking
    // through 'foo' as a directory segment hits the file directly.
    const ds = makeDs(new InMemoryWebFsDirectoryHandle(), '', ['']);
    await ds.createOrUpdate('foo', '{}', '');

    const result = await ds.createFolder('foo/bar');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(FileInsteadOfDir);
  });
});

describe('WebFsDataSource.deleteAtoms', () => {
  const collect = async (ds: WebFsDataSource, keys: readonly string[]) => {
    const results: Result.Result<string, unknown>[] = [];
    for await (const r of ds.deleteAtoms(keys)) results.push(r);
    return results;
  };

  it('deletes an object by logical key', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    await ds.createOrUpdate('doc', '{}', 'json');

    const [result] = await collect(ds, ['doc']);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) expect(result.success).toBe('doc');

    const read = await ds.getObjectContents('doc');
    expect(Result.isFailure(read)).toBe(true);
  });

  it('deletes an empty folder', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    await ds.createFolder('empty-dir');

    const [result] = await collect(ds, ['empty-dir']);
    expect(Result.isSuccess(result)).toBe(true);

    const meta = await ds.getFolderMeta('empty-dir');
    expect(Result.isFailure(meta)).toBe(true);
  });

  it('refuses to delete a folder with content', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    await ds.createOrUpdate('full-dir/child', '{"keep":true}', 'json');

    const [result] = await collect(ds, ['full-dir']);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(ForbiddenError);

    const survivor = await ds.getObjectContents('full-dir/child');
    expect(Result.isSuccess(survivor) && survivor.success.content).toBe('{"keep":true}');
  });

  it('refuses to delete the repository root', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    const [result] = await collect(ds, ['']);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(ForbiddenError);
  });

  it('yields NotFoundError for a key that is neither an object nor a folder', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    const [result] = await collect(ds, ['nope']);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.code).toBe('not_found');
  });

  it('processes multiple keys independently, one Result per key', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    await ds.createOrUpdate('a', '{}', 'json');
    await ds.createOrUpdate('b', '{}', 'json');

    const results = await collect(ds, ['a', 'b', 'missing']);
    expect(results.map(Result.isSuccess)).toEqual([true, true, false]);
  });
});

describe('WebFsDataSource: permission and lifecycle gates on resolveRoot', () => {
  it('a throwing root provider surfaces as IllegalStateException with the cause preserved', async () => {
    const lookupFailure = new Error('handle lookup failed');
    const ds = new WebFsDataSource(
      async () => {
        throw lookupFailure;
      },
      '',
      ['json'],
    );

    const result = await ds.getObjectContents('anything');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(IllegalStateException);
      expect((result.failure as IllegalStateException).cause).toBe(lookupFailure);
    }
  });

  it("queryPermission 'prompt' fails typed with PermissionPromptRequiredError", async () => {
    const root = new InMemoryPickedDirectoryHandle();
    root.permissionState = 'prompt';
    const ds = makeDs(root);

    const result = await ds.getObjectContents('anything');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(PermissionPromptRequiredError);
  });

  it("queryPermission 'denied' fails typed with PermissionDeniedError", async () => {
    const root = new InMemoryPickedDirectoryHandle();
    root.permissionState = 'denied';
    const ds = makeDs(root);

    const result = await ds.getObjectContents('anything');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(PermissionDeniedError);
  });

  it('a granted handle whose directory no longer exists fails with StaleHandleError', async () => {
    const root = new InMemoryPickedDirectoryHandle();
    const ds = makeDs(root);
    await ds.createOrUpdate('doc', '{}', 'json');

    root.disconnect();
    const result = await ds.getObjectContents('doc');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(StaleHandleError);
  });

  it('a handle without queryPermission (origin-private style) is treated as granted', async () => {
    const ds = makeDs(new InMemoryWebFsDirectoryHandle());
    await ds.createOrUpdate('doc', '{"ok":true}', 'json');

    const result = await ds.getObjectContents('doc');
    expect(Result.isSuccess(result) && result.success.content).toBe('{"ok":true}');
  });

  it("queryPermission receives the configured mode ('readwrite' by default)", async () => {
    const root = new InMemoryPickedDirectoryHandle();
    const ds = makeDs(root);
    await ds.createFolder('a');
    expect(root.permissionQueries[0]).toEqual({ mode: 'readwrite' });
  });

  it('permission state is re-checked on every operation, never cached', async () => {
    const root = new InMemoryPickedDirectoryHandle();
    const ds = makeDs(root);
    await ds.createOrUpdate('doc', '{}', 'json');

    root.permissionState = 'denied';
    const result = await ds.getObjectContents('doc');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(PermissionDeniedError);
  });
});

describe('WebFsDataSource: namespace isolation', () => {
  it('two data sources sharing one root under different namespaces never see the same objects', async () => {
    const shared = new InMemoryWebFsDirectoryHandle();
    const dsA = makeDs(shared, 'app-a');
    const dsB = makeDs(shared, 'app-b');

    await dsA.createOrUpdate('shared-key', 'a', 'json');
    await dsB.createOrUpdate('shared-key', 'b', 'json');

    const fromA = await dsA.getObjectContents('shared-key');
    const fromB = await dsB.getObjectContents('shared-key');
    expect(Result.isSuccess(fromA) && fromA.success.content).toBe('a');
    expect(Result.isSuccess(fromB) && fromB.success.content).toBe('b');
  });
});
