import * as Effect from 'effect/Effect';
import * as fs from 'fs/promises';
import { BadRequestError, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rawSerializer } from 'laikacms/serializers/raw';
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
