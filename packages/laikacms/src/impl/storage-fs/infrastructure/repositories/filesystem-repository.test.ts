import * as Effect from 'effect/Effect';
import * as fs from 'fs/promises';
import { LaikaStream, NotFoundError } from 'laikacms/core';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
