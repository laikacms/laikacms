import * as Effect from 'effect/Effect';
import { describe, expect, it } from 'vitest';

import { NotFoundError } from 'laikacms/core';

import type { AtomSummary } from '../domain/entities/index.js';
import { collectAtomSummariesWithDepth } from './collect-atoms-with-depth.js';

const obj = (key: string): AtomSummary => ({ type: 'object-summary', key });
const folder = (key: string): AtomSummary => ({ type: 'folder-summary', key });

const run = (eff: Effect.Effect<AtomSummary[], unknown>) => Effect.runPromise(eff);

describe('collectAtomSummariesWithDepth', () => {
  it('depth=1 returns only the immediate children of the root folder', async () => {
    const listFolderLevel = (key: string) =>
      key === ''
        ? Effect.succeed([obj('a'), folder('b'), obj('c')])
        : Effect.fail(new NotFoundError({ key, message: 'should not recurse' }));

    const result = await run(collectAtomSummariesWithDepth('', listFolderLevel, 1));
    expect(result.map(s => s.key)).toEqual(['a', 'b', 'c']);
  });

  it('depth=1 does not recurse into sub-folders', async () => {
    let calls = 0;
    const listFolderLevel = (key: string) => {
      calls++;
      if (key === '') return Effect.succeed([folder('sub')]);
      return Effect.succeed([obj('sub/child')]);
    };

    await run(collectAtomSummariesWithDepth('', listFolderLevel, 1));
    expect(calls).toBe(1);
  });

  it('depth=2 includes immediate children and their sub-folder children', async () => {
    const tree: Record<string, AtomSummary[]> = {
      '': [obj('root-file'), folder('dir')],
      'dir': [obj('dir/file'), folder('dir/sub')],
      'dir/sub': [obj('dir/sub/deep')],
    };
    const listFolderLevel = (key: string) => Effect.succeed(tree[key] ?? []);

    const result = await run(collectAtomSummariesWithDepth('', listFolderLevel, 2));
    expect(result.map(s => s.key).sort()).toEqual([
      'dir',
      'dir/file',
      'dir/sub',
      'root-file',
    ]);
  });

  it('depth=3 recurses three levels deep', async () => {
    const tree: Record<string, AtomSummary[]> = {
      '': [folder('a')],
      'a': [folder('a/b')],
      'a/b': [folder('a/b/c')],
      'a/b/c': [obj('a/b/c/leaf')],
    };
    const listFolderLevel = (key: string) => Effect.succeed(tree[key] ?? []);

    const result = await run(collectAtomSummariesWithDepth('', listFolderLevel, 3));
    expect(result.map(s => s.key).sort()).toEqual(['a', 'a/b', 'a/b/c']);
  });

  it('depth=4 reaches the fourth level', async () => {
    const tree: Record<string, AtomSummary[]> = {
      '': [folder('a')],
      'a': [folder('a/b')],
      'a/b': [folder('a/b/c')],
      'a/b/c': [obj('a/b/c/leaf')],
    };
    const listFolderLevel = (key: string) => Effect.succeed(tree[key] ?? []);

    const result = await run(collectAtomSummariesWithDepth('', listFolderLevel, 4));
    expect(result.map(s => s.key).sort()).toEqual(['a', 'a/b', 'a/b/c', 'a/b/c/leaf']);
  });

  it('swallows sub-folder listing failures and continues with accessible siblings', async () => {
    const tree: Record<string, AtomSummary[]> = {
      '': [folder('ok'), folder('bad'), folder('also-ok')],
      'ok': [obj('ok/file')],
      'also-ok': [obj('also-ok/file')],
    };
    const listFolderLevel = (key: string) => {
      if (key === 'bad') return Effect.fail(new NotFoundError({ key, message: 'gone' }));
      return Effect.succeed(tree[key] ?? []);
    };

    const result = await run(collectAtomSummariesWithDepth('', listFolderLevel, 2));
    // 'bad' sub-tree silently omitted; the rest come through
    expect(result.map(s => s.key).sort()).toEqual(['also-ok', 'also-ok/file', 'bad', 'ok', 'ok/file']);
  });

  it('does not recurse into object-summary atoms even at depth > 1', async () => {
    let calls = 0;
    const listFolderLevel = (key: string) => {
      calls++;
      if (key === '') return Effect.succeed([obj('file1'), obj('file2')]);
      return Effect.succeed([]);
    };

    await run(collectAtomSummariesWithDepth('', listFolderLevel, 3));
    // only the root call; object-summaries must not trigger recursion
    expect(calls).toBe(1);
  });

  it('returns an empty array when the folder is empty', async () => {
    const result = await run(
      collectAtomSummariesWithDepth('', () => Effect.succeed([]), 2),
    );
    expect(result).toEqual([]);
  });

  it('propagates root-level failures (not swallowed)', async () => {
    const err = new NotFoundError({ key: '', message: 'root gone' });
    await expect(
      run(collectAtomSummariesWithDepth('', () => Effect.fail(err), 2)),
    ).rejects.toThrow();
  });
});
