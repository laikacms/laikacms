import * as Effect from 'effect/Effect';
import * as fs from 'fs/promises';
import { BadRequestError, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rawSerializer } from 'laikacms/serializers/raw';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { FileSystemStorageRepository } from './filesystem-repository.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-fs-repo-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const makeRepo = () =>
  new FileSystemStorageRepository(
    tmpDir,
    { md: { serialize: (x: unknown) => String(x), deserialize: (x: string) => x } as never },
    'md',
  );

describe('FileSystemStorageRepository natural ordering', () => {
  it('sorts numeric filenames naturally (2.md before 10.md)', async () => {
    await fs.writeFile(path.join(tmpDir, '1.md'), '');
    await fs.writeFile(path.join(tmpDir, '2.md'), '');
    await fs.writeFile(path.join(tmpDir, '10.md'), '');
    await fs.writeFile(path.join(tmpDir, '11.md'), '');

    const repo = makeRepo();
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10', '11']);
  });

  it('sorts mixed numeric/alpha names naturally', async () => {
    await fs.writeFile(path.join(tmpDir, 'invoice-2.md'), '');
    await fs.writeFile(path.join(tmpDir, 'invoice-10.md'), '');
    await fs.writeFile(path.join(tmpDir, 'invoice-1.md'), '');

    const repo = makeRepo();
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key)).toEqual(['invoice-1', 'invoice-2', 'invoice-10']);
  });
});

describe('FileSystemStorageRepository ignoreList', () => {
  it('does not surface .keep files in listAtomSummaries', async () => {
    await fs.writeFile(path.join(tmpDir, '.keep'), '');
    await fs.writeFile(path.join(tmpDir, 'real.md'), '');

    const repo = makeRepo();
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key)).toEqual(['real']);
  });

  it('does not surface .gitkeep files in listAtomSummaries', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitkeep'), '');
    await fs.writeFile(path.join(tmpDir, 'real.md'), '');

    const repo = makeRepo();
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key)).toEqual(['real']);
  });

  it('does not surface nested .gitkeep files in listAtomSummaries', async () => {
    await fs.mkdir(path.join(tmpDir, 'subfolder'));
    await fs.writeFile(path.join(tmpDir, 'subfolder', '.gitkeep'), '');
    await fs.writeFile(path.join(tmpDir, 'real.md'), '');

    const repo = makeRepo();
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key)).toEqual(['real', 'subfolder']);

    const nestedCollected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('subfolder', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(nestedCollected.data).toEqual([]);
  });
});

describe('FileSystemStorageRepository pagination total', () => {
  it('listAtomSummaries Done.total reflects aggregate count, not page count', async () => {
    for (let i = 1; i <= 5; i++) {
      await fs.writeFile(path.join(tmpDir, `item-${i}.md`), '');
    }

    const repo = makeRepo();
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { page: 1, perPage: 2 } }),
    );

    expect(collected.data).toHaveLength(2);
    expect(collected.done).toEqual({ total: 5 });
  });
});

describe('FileSystemStorageRepository listing a missing folder', () => {
  it('listAtomSummaries yields no data and a NotFoundError as a recoverable error', async () => {
    const repo = makeRepo();
    const stream = repo.listAtomSummaries('does/not/exist', { pagination: { offset: 0, limit: 100 } });
    const collected = await Effect.runPromise(LaikaStream.runCollect(stream));

    expect(collected.data).toEqual([]);
    expect(collected.done).toEqual({ total: 0 });
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('listAtoms yields no data and a NotFoundError as a recoverable error', async () => {
    const repo = makeRepo();
    const stream = repo.listAtoms('does/not/exist', { pagination: { offset: 0, limit: 100 } });
    const collected = await Effect.runPromise(LaikaStream.runCollect(stream));

    expect(collected.data).toEqual([]);
    expect(collected.done).toEqual({ total: 0 });
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });
});

describe('FileSystemStorageRepository listAtomSummaries timestamps (LCMS-278)', () => {
  it('populates createdAt and updatedAt on object-summary entries', async () => {
    const before = new Date();
    await fs.writeFile(path.join(tmpDir, 'post.md'), 'hello');
    const after = new Date();

    const repo = makeRepo();
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data).toHaveLength(1);
    const summary = collected.data[0];
    expect(summary.type).toBe('object-summary');
    expect(summary.createdAt).toBeDefined();
    expect(summary.updatedAt).toBeDefined();
    const createdAt = new Date(summary.createdAt!);
    const updatedAt = new Date(summary.updatedAt!);
    expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it('populates createdAt and updatedAt on folder-summary entries', async () => {
    const before = new Date();
    await fs.mkdir(path.join(tmpDir, 'drafts'));
    await fs.writeFile(path.join(tmpDir, 'drafts', '.keep'), '');
    const after = new Date();

    const repo = makeRepo();
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    const folderSummary = collected.data.find(s => s.type === 'folder-summary');
    expect(folderSummary).toBeDefined();
    expect(folderSummary!.createdAt).toBeDefined();
    expect(folderSummary!.updatedAt).toBeDefined();
    const updatedAt = new Date(folderSummary!.updatedAt!);
    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });
});

// LCMS-245: rawSerializer throws when content has extra fields beyond 'body'.
// Before the fix, Effect.promise() treated the thrown rejection as a defect
// that bypassed Effect.matchEffect, leaving the LaikaTask Queue unsignalled
// and causing runTaskWithMetadata to hang forever.
describe('FileSystemStorageRepository rawSerializer extra-field error propagation (LCMS-245)', () => {
  const makeRawRepo = () => new FileSystemStorageRepository(tmpDir, { raw: rawSerializer }, 'raw');

  it('createObject with extra field returns a typed BadRequestError failure instead of hanging', async () => {
    const repo = makeRawRepo();

    // Wrap in a race against a short timeout so the test fails fast if we regress to a hang.
    const settled = await Promise.race([
      LaikaTask.runPromiseResult(
        repo.createObject({ key: 'notes/hello', type: 'object', content: { body: 'hi', title: 'dropped' } }),
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('createObject hung — LCMS-245 regression')), 3000)
      ),
    ]);

    // Must be a failure (not a success, not a hang)
    expect(settled).toMatchObject({ _tag: 'Failure' });
    const err = (settled as { failure: unknown }).failure;
    expect(err).toBeInstanceOf(BadRequestError);
    expect((err as BadRequestError).message).toContain('title');
  });

  it('createObject with only body field succeeds normally', async () => {
    const repo = makeRawRepo();
    const result = await LaikaTask.runPromiseResult(
      repo.createObject({ key: 'notes/simple', type: 'object', content: { body: 'hello world' } }),
    );
    expect(result).toMatchObject({ _tag: 'Success' });
    expect((result as { success: { content: { body: unknown } } }).success.content.body).toBe('hello world');
  });
});

// LCMS-278: removeAtoms must not blindly strip the last dot-segment from a key
// that happens to contain a dot (e.g. releases/v1.2-notes). Only a suffix that
// matches a registered serializer extension should be stripped when probing for
// the physical file, otherwise the delete misses the file entirely.
describe('FileSystemStorageRepository removeAtoms dotted-key (LCMS-278)', () => {
  it('removes a dotted key whose dot-segment is not a known extension', async () => {
    const repo = new FileSystemStorageRepository(tmpDir, { raw: rawSerializer }, 'raw');

    // Write two keys whose names contain dots that are NOT serializer extensions.
    await LaikaTask.runPromise(
      repo.createObject({ key: 'releases/v1.2-notes', type: 'object', content: { body: 'v1.2' } }),
    );
    await LaikaTask.runPromise(
      repo.createObject({ key: 'releases/v1.9-notes', type: 'object', content: { body: 'v1.9' } }),
    );

    // Confirm both files exist independently.
    const before = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('releases', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(before.data.map(s => s.key)).toContain('releases/v1.2-notes');
    expect(before.data.map(s => s.key)).toContain('releases/v1.9-notes');

    // Delete only the first one.
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['releases/v1.2-notes']),
    );
    expect(removed.done.removed).toBe(1);
    expect(removed.done.skipped).toBe(0);

    // v1.2-notes gone, v1.9-notes untouched.
    const after = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('releases', { pagination: { offset: 0, limit: 100 } }),
    );
    const keys = after.data.map(s => s.key);
    expect(keys).not.toContain('releases/v1.2-notes');
    expect(keys).toContain('releases/v1.9-notes');
  });
});

// LCMS-269: ContentBase keys its settings/trash/drafts/revisions under a
// top-level dot-prefixed segment (`.contentbase/...`, `.laikacms/...`). Those
// segments are also in the default ignoreList, but getObject must still
// settle (resolve the object or fail NotFound) for them — ignoreList only
// governs listings, not direct key reads. Guarded with a race-against-timeout
// so a regression to a hung LaikaTask fails fast instead of hanging CI.
describe('FileSystemStorageRepository getObject on top-level dot-prefixed keys (LCMS-269)', () => {
  const withTimeout = <A>(promise: Promise<A>, label: string): Promise<A> =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} hung — LCMS-269 regression`)), 3000)
      ),
    ]);

  it('resolves NotFoundError (rather than hanging) for a top-level dot-prefixed key with no file', async () => {
    const repo = new FileSystemStorageRepository(tmpDir, { json: jsonSerializer }, 'json');

    for (const key of ['.contentbase/settings', '.contentbase', '.hidden/x', '.dotfile']) {
      const result = await withTimeout(LaikaTask.runPromiseResult(repo.getObject(key)), `getObject('${key}')`);
      expect(result._tag).toBe('Failure');
      expect((result as { failure: NotFoundError }).failure).toBeInstanceOf(NotFoundError);
    }
  });

  it('reads back real content stored under a top-level dot-prefixed key', async () => {
    const repo = new FileSystemStorageRepository(tmpDir, { json: jsonSerializer }, 'json');

    await withTimeout(
      LaikaTask.runPromise(
        repo.createObject({
          key: '.contentbase/settings',
          type: 'object',
          content: { collections: {} },
        }),
      ),
      "createObject('.contentbase/settings')",
    );

    const result = await withTimeout(
      LaikaTask.runPromiseResult(repo.getObject('.contentbase/settings')),
      "getObject('.contentbase/settings')",
    );
    expect(result._tag).toBe('Success');
    expect((result as { success: { key: string, content: unknown } }).success.content).toEqual({ collections: {} });
  });

  it('does not mis-resolve a dot-prefixed key to the empty-key file at the storage root', async () => {
    const repo = new FileSystemStorageRepository(tmpDir, { json: jsonSerializer }, 'json');

    // Write the empty-key file directly (simulates a pre-existing root default).
    await fs.writeFile(path.join(tmpDir, '.json'), JSON.stringify({ marker: 'root-empty-key' }));

    const result = await withTimeout(
      LaikaTask.runPromiseResult(repo.getObject('.dotfile')),
      "getObject('.dotfile')",
    );
    // Must not resolve to the unrelated root `.json` file's content.
    expect(result._tag).toBe('Failure');
    expect((result as { failure: NotFoundError }).failure).toBeInstanceOf(NotFoundError);
  });
});

describe('FileSystemStorageRepository — getCapabilities', () => {
  it('returns a compatibilityDate string and a pagination object', async () => {
    const repo = makeRepo();
    const caps = await LaikaTask.runPromise(repo.getCapabilities());
    expect(typeof caps.compatibilityDate).toBe('string');
    expect(caps.compatibilityDate.length).toBeGreaterThan(0);
    expect(caps.pagination).toBeDefined();
    expect(caps.pagination.supported).toBe(true);
  });
});
