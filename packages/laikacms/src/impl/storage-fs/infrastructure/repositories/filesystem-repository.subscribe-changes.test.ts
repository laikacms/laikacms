import * as fs from 'fs/promises';
import { LaikaTask } from 'laikacms/core';
import type { ChangeSummary } from 'laikacms/storage';
import { writeFileSync } from 'node:fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileSystemStorageRepository } from './filesystem-repository.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-fs-subscribe-test-'));
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

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Collects every batch a listener receives, flattened for easy assertions. */
function collector() {
  const batches: ChangeSummary[][] = [];
  const listener = (changes: readonly ChangeSummary[]) => batches.push([...changes]);
  return { batches, listener, flat: () => batches.flat() };
}

/** Poll `predicate` until it is true or the timeout elapses. */
async function waitFor(predicate: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error('timeout waiting for condition');
}

describe('FileSystemStorageRepository.subscribeChanges', () => {
  it('advertises the subscription capability', async () => {
    const repo = makeRepo();
    const caps = await LaikaTask.runPromise(repo.getCapabilities());
    expect(caps.changes.supported).toBe(true);
    if (caps.changes.supported) {
      expect(caps.changes.subscription).toBe(true);
    }
  });

  it('emits { key, deleted: false } when a file is written', async () => {
    const repo = makeRepo();
    const { listener, flat } = collector();
    const unsub = repo.subscribeChanges({}, listener);
    await delay(50);

    writeFileSync(path.join(tmpDir, 'hello.md'), 'hi');
    await waitFor(() => flat().some(c => c.key === 'hello' && !c.deleted));

    unsub();
  });

  it('strips the serializer extension and drops ignoreList matches', async () => {
    const repo = makeRepo();
    const { listener, flat } = collector();
    const unsub = repo.subscribeChanges({}, listener);
    await delay(50);

    writeFileSync(path.join(tmpDir, '.keep'), '');
    writeFileSync(path.join(tmpDir, 'note.md'), 'x');
    await waitFor(() => flat().some(c => c.key === 'note'));
    await delay(120);

    const keys = flat().map(c => c.key);
    expect(keys).toContain('note'); // extension stripped: note.md -> note
    expect(keys).not.toContain('note.md');
    expect(keys).not.toContain('.keep'); // ignoreList match dropped

    unsub();
  });

  it('emits deleted: true when a file is removed', async () => {
    await fs.writeFile(path.join(tmpDir, 'gone.md'), 'x');
    const repo = makeRepo();
    const { listener, flat } = collector();
    const unsub = repo.subscribeChanges({}, listener);
    await delay(50);

    await fs.rm(path.join(tmpDir, 'gone.md'));
    await waitFor(() => flat().some(c => c.key === 'gone' && c.deleted));

    unsub();
  });

  it('multicasts one change to every listener', async () => {
    const repo = makeRepo();
    const a = collector();
    const b = collector();
    const unsubA = repo.subscribeChanges({}, a.listener);
    const unsubB = repo.subscribeChanges({}, b.listener);
    await delay(50);

    writeFileSync(path.join(tmpDir, 'multi.md'), 'x');
    await waitFor(() => a.flat().some(c => c.key === 'multi') && b.flat().some(c => c.key === 'multi'));

    unsubA();
    unsubB();
  });

  it('scopes a subscription to its folder', async () => {
    await fs.mkdir(path.join(tmpDir, 'sub'), { recursive: true });
    const repo = makeRepo();
    const { listener, flat } = collector();
    const unsub = repo.subscribeChanges({ folder: 'sub' }, listener);
    await delay(50);

    writeFileSync(path.join(tmpDir, 'sub', 'inside.md'), 'x');
    writeFileSync(path.join(tmpDir, 'outside.md'), 'x');
    await waitFor(() => flat().some(c => c.key === 'sub/inside'));
    await delay(120);

    const keys = flat().map(c => c.key);
    expect(keys).toContain('sub/inside');
    expect(keys).not.toContain('outside');

    unsub();
  });

  it('coalesces a burst of writes to one key into a single entry (debounce)', async () => {
    const repo = makeRepo();
    const { listener, flat } = collector();
    const unsub = repo.subscribeChanges({}, listener);
    await delay(50);

    for (let i = 0; i < 5; i++) {
      writeFileSync(path.join(tmpDir, 'burst.md'), `v${i}`);
    }
    await waitFor(() => flat().some(c => c.key === 'burst'));
    await delay(120);

    const burstEntries = flat().filter(c => c.key === 'burst');
    expect(burstEntries).toHaveLength(1);

    unsub();
  });

  it('stops delivery and closes the watch handle on the last unsubscribe', async () => {
    const repo = makeRepo();
    const { listener, flat } = collector();
    const unsub = repo.subscribeChanges({}, listener);
    await delay(50);

    unsub();
    // The single shared watch handle is released once the last listener leaves.
    expect((repo as unknown as { watcher: unknown }).watcher).toBeUndefined();

    writeFileSync(path.join(tmpDir, 'after.md'), 'x');
    await delay(200);
    expect(flat().some(c => c.key === 'after')).toBe(false);
  });
});
