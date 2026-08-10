import { collectStream, runTask } from 'laikacms/compat';
import {
  ForbiddenError,
  IllegalStateException,
  InvalidData,
  type LaikaError,
  LaikaStream,
  PermissionDeniedError,
  PermissionPromptRequiredError,
  QuotaExceededError,
  StaleHandleError,
} from 'laikacms/core';

import { describe, expect, it, vi } from 'vitest';

import type { WebFsFileHandle } from '../../domain/types/web-fs-handles.js';
import { InMemoryPickedDirectoryHandle, InMemoryWebFsDirectoryHandle } from '../../testing.js';
import { WebFsStorageRepository } from './web-fs-storage-repository.js';

const jsonSerializer = {
  format: 'json' as const,
  async serializeDocumentFileContents(content: unknown): Promise<string> {
    return JSON.stringify(content);
  },
  async deserializeDocumentFileContents(raw: string): Promise<unknown> {
    return JSON.parse(raw);
  },
};

const makeRepo = (root: InMemoryWebFsDirectoryHandle, namespace?: string) =>
  new WebFsStorageRepository({
    root,
    serializerRegistry: { json: jsonSerializer },
    defaultExtension: 'json',
    ...(namespace === undefined ? {} : { namespace }),
  });

describe('WebFsStorageRepository: namespace isolation', () => {
  it("two repositories sharing one root under different namespaces never see each other's entries", async () => {
    const shared = new InMemoryWebFsDirectoryHandle();
    const repoA = makeRepo(shared, 'app-a');
    const repoB = makeRepo(shared, 'app-b');

    await runTask(repoA.createObject({ key: 'shared-key', type: 'object', content: { owner: 'a' } }));
    await runTask(repoB.createObject({ key: 'shared-key', type: 'object', content: { owner: 'b' } }));

    const fromA = await runTask(repoA.getObject('shared-key'));
    const fromB = await runTask(repoB.getObject('shared-key'));
    expect(fromA.content).toMatchObject({ owner: 'a' });
    expect(fromB.content).toMatchObject({ owner: 'b' });

    // Deleting from one namespace must not remove the other namespace's object.
    await runTask(repoA.removeAtoms(['shared-key']));
    await expect(runTask(repoA.getObject('shared-key'))).rejects.toThrow();
    const stillThere = await runTask(repoB.getObject('shared-key'));
    expect(stillThere.content).toMatchObject({ owner: 'b' });
  });
});

describe('WebFsStorageRepository: real directory hierarchy', () => {
  it('an explicitly created empty folder exists and lists as empty — no .keep marker, no NotFound warning', async () => {
    const repo = makeRepo(new InMemoryWebFsDirectoryHandle());
    await runTask(repo.createFolder({ key: 'articles/drafts', type: 'folder' }));

    const folder = await runTask(repo.getFolder('articles/drafts'));
    expect(folder.type).toBe('folder');

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('articles/drafts', { depth: 1, pagination: { offset: 0, limit: 10 } }),
    );
    expect(collected.data).toHaveLength(0);
    expect(collected.recoverableErrors).toHaveLength(0);
    expect(collected.done.total).toBe(0);
  });

  it('removeAtoms deletes an empty folder but refuses a folder with content', async () => {
    const repo = makeRepo(new InMemoryWebFsDirectoryHandle());
    await runTask(repo.createFolder({ key: 'empty-dir', type: 'folder' }));
    await runTask(repo.createObject({ key: 'full-dir/child', type: 'object', content: { keep: true } }));

    const emptyResult = await collectStream(repo.removeAtoms(['empty-dir']));
    expect(emptyResult.done.removed).toBe(1);
    await expect(runTask(repo.getFolder('empty-dir'))).rejects.toThrow();

    const fullResult = await LaikaStream.runPromiseCollect(repo.removeAtoms(['full-dir']));
    expect(fullResult.done.skipped).toBe(1);
    expect(fullResult.recoverableErrors[0]).toBeInstanceOf(ForbiddenError);
    const survivor = await runTask(repo.getObject('full-dir/child'));
    expect(survivor.content).toMatchObject({ keep: true });
  });
});

describe('WebFsStorageRepository: path traversal', () => {
  it('rejects keys with ".." segments as typed InvalidData on read and write', async () => {
    const repo = makeRepo(new InMemoryWebFsDirectoryHandle());
    await expect(runTask(repo.getObject('../escape'))).rejects.toBeInstanceOf(InvalidData);
    await expect(
      runTask(repo.createObject({ key: 'a/../../escape', type: 'object', content: {} })),
    ).rejects.toBeInstanceOf(InvalidData);
  });
});

describe('WebFsStorageRepository: quota-exceeded mapping', () => {
  it('maps a QuotaExceededError DOMException from createWritable to the typed domain error, not a raw throw', async () => {
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
    // namespace '' keeps writes at the root, so the failing override is hit directly.
    const repo = makeRepo(new QuotaExceededRoot(), '');

    await expect(
      runTask(repo.createObject({ key: 'too-big', type: 'object', content: { big: 'x'.repeat(10) } })),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });
});

describe('WebFsStorageRepository: permission gate', () => {
  const expectTypedRejection = async (
    promise: Promise<unknown>,
    errorClass: { new(...args: never[]): LaikaError, CODE: string, STATUS: number },
  ) => {
    const error = await promise.then(
      () => {
        throw new Error('expected the operation to reject');
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(errorClass);
    const typed = error as LaikaError;
    expect(typed.code).toBe(errorClass.CODE);
    expect(typed.status).toBe(errorClass.STATUS);
    return typed;
  };

  it("queryPermission 'prompt' fails typed with PermissionPromptRequiredError — the app re-prompts, never the repository", async () => {
    const root = new InMemoryPickedDirectoryHandle();
    root.permissionState = 'prompt';
    await expectTypedRejection(runTask(makeRepo(root).getObject('anything')), PermissionPromptRequiredError);
  });

  it("queryPermission 'denied' fails typed with PermissionDeniedError", async () => {
    const root = new InMemoryPickedDirectoryHandle();
    root.permissionState = 'denied';
    await expectTypedRejection(runTask(makeRepo(root).getObject('anything')), PermissionDeniedError);
  });

  it('permission state is re-checked on every operation, never cached — a mid-session revocation is caught', async () => {
    const root = new InMemoryPickedDirectoryHandle();
    const repo = makeRepo(root);
    await runTask(repo.createObject({ key: 'doc', type: 'object', content: { ok: true } }));

    root.permissionState = 'denied';
    await expectTypedRejection(runTask(repo.getObject('doc')), PermissionDeniedError);
  });

  it('a granted handle whose directory no longer exists fails with StaleHandleError, not a misleading NotFound', async () => {
    const root = new InMemoryPickedDirectoryHandle();
    const repo = makeRepo(root);
    await runTask(repo.createObject({ key: 'doc', type: 'object', content: { ok: true } }));

    root.disconnect();
    await expectTypedRejection(runTask(repo.getObject('doc')), StaleHandleError);
  });

  it('a NotAllowedError DOMException mid-operation maps to PermissionDeniedError', async () => {
    class RevokedMidWriteRoot extends InMemoryWebFsDirectoryHandle {
      override async getFileHandle(): Promise<WebFsFileHandle> {
        throw new DOMException('User activation is required', 'NotAllowedError');
      }
    }
    // namespace '' keeps writes at the root, so the failing override is hit directly.
    const repo = makeRepo(new RevokedMidWriteRoot(), '');
    await expectTypedRejection(
      runTask(repo.createObject({ key: 'doc', type: 'object', content: {} })),
      PermissionDeniedError,
    );
  });

  it('a throwing root provider surfaces as a typed IllegalStateException with the cause preserved', async () => {
    const lookupFailure = new Error('handle lookup failed');
    const repo = new WebFsStorageRepository({
      root: async () => {
        throw lookupFailure;
      },
      serializerRegistry: { json: jsonSerializer },
      defaultExtension: 'json',
    });
    const error = await runTask(repo.getObject('anything')).then(
      () => {
        throw new Error('expected the operation to reject');
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(IllegalStateException);
    expect((error as IllegalStateException).cause).toBe(lookupFailure);
  });

  it('construction never invokes the root provider; the first operation does', async () => {
    const root = new InMemoryWebFsDirectoryHandle();
    const provider = vi.fn(async () => root);
    const repo = new WebFsStorageRepository({
      root: provider,
      serializerRegistry: { json: jsonSerializer },
      defaultExtension: 'json',
    });
    expect(provider).not.toHaveBeenCalled();
    await runTask(repo.createFolder({ key: 'articles', type: 'folder' }));
    expect(provider).toHaveBeenCalled();
  });

  it('a handle without queryPermission (origin-private style) is treated as granted', async () => {
    const repo = makeRepo(new InMemoryWebFsDirectoryHandle());
    await runTask(repo.createObject({ key: 'doc', type: 'object', content: { ok: true } }));
    const read = await runTask(repo.getObject('doc'));
    expect(read.content).toMatchObject({ ok: true });
  });

  it("queryPermission receives the configured mode ('readwrite' by default, 'read' when set)", async () => {
    const defaultRoot = new InMemoryPickedDirectoryHandle();
    await runTask(makeRepo(defaultRoot).createFolder({ key: 'a', type: 'folder' }));
    expect(defaultRoot.permissionQueries[0]).toEqual({ mode: 'readwrite' });

    const readRoot = new InMemoryPickedDirectoryHandle();
    const readRepo = new WebFsStorageRepository({
      root: readRoot,
      mode: 'read',
      serializerRegistry: { json: jsonSerializer },
      defaultExtension: 'json',
    });
    await runTask(readRepo.getFolder('')).catch(() => undefined);
    expect(readRoot.permissionQueries[0]).toEqual({ mode: 'read' });
  });
});

describe('WebFsStorageRepository: SSR safety', () => {
  it('constructs without a `root` option, and only fails — typed — when an operation actually runs', async () => {
    // This test's environment (Node/vitest) has no navigator.storage.getDirectory,
    // the same shape SSR runs in.
    const repo = new WebFsStorageRepository({ serializerRegistry: { json: jsonSerializer }, defaultExtension: 'json' });
    expect(repo).toBeInstanceOf(WebFsStorageRepository);
    await expect(runTask(repo.getObject('anything'))).rejects.toBeInstanceOf(IllegalStateException);
  });

  it('getCapabilities works without ever needing a file system', async () => {
    const repo = new WebFsStorageRepository({ serializerRegistry: { json: jsonSerializer }, defaultExtension: 'json' });
    const caps = await runTask(repo.getCapabilities());
    expect(caps.fileExtensions.supported).toBe(true);
  });
});
