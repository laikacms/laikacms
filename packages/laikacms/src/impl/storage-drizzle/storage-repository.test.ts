import * as Effect from 'effect/Effect';
import { describe, expect, it } from 'vitest';

import { ForbiddenError, InternalError, LaikaStream, NotFoundError } from 'laikacms/core';

import {
  type DrizzleStorageCallbacks,
  type DrizzleStorageQueryBuilders,
  DrizzleStorageRepository,
  type StorageModel,
} from './storage-repository.js';

type Cond = { kind: 'eq', key: string };

const makeRepo = (
  deleteOverride: DrizzleStorageCallbacks['delete'],
  selectOverride?: DrizzleStorageCallbacks['select'],
) => {
  const queryBuilders: DrizzleStorageQueryBuilders = {
    keyEquals: value => ({ kind: 'eq', key: value }) as Cond,
    keyStartsWith: () => ({}),
    depthLte: () => ({}),
    and: () => ({}),
  };

  const callbacks: DrizzleStorageCallbacks = {
    async insert({ values }) {
      return [{ ...values }];
    },
    async update() {
      return [];
    },
    delete: deleteOverride,
    select: selectOverride ?? (async () => []),
  };

  return new DrizzleStorageRepository({ queryBuilders, callbacks });
};

const row = (key: string): StorageModel => ({
  key,
  type: 'object',
  content: '{}',
  depth: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('DrizzleStorageRepository.removeAtoms', () => {
  it('emits recoverableError + counts skipped when the delete callback throws mid-stream', async () => {
    const repo = makeRepo(async ({ where }) => {
      const key = (where as Cond).key;
      if (key === 'b') throw new Error('boom: connection lost');
      return [row(key)];
    });

    const collected = await Effect.runPromise(
      LaikaStream.runCollect(repo.removeAtoms(['a', 'b', 'c'])),
    );

    expect(collected.data).toEqual(['a', 'c']);
    expect(collected.done).toEqual({ removed: 2, skipped: 1 });
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(InternalError);
    expect(collected.recoverableErrors[0]!.message).toContain('"b"');
    expect(collected.recoverableErrors[0]!.message).toContain('boom: connection lost');
  });

  it('emits ForbiddenError and counts skipped when delete returns 0 rows and children exist (folder key)', async () => {
    const repo = makeRepo(
      async () => [],
      async () => [row('folder/child')],
    );

    const collected = await Effect.runPromise(
      LaikaStream.runCollect(repo.removeAtoms(['folder'])),
    );

    expect(collected.data).toEqual([]);
    expect(collected.done).toEqual({ removed: 0, skipped: 1 });
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(ForbiddenError);
    expect(collected.recoverableErrors[0]!.message).toContain("'folder'");
  });

  it('emits NotFoundError and counts skipped when delete returns 0 rows and no children exist (missing key)', async () => {
    const repo = makeRepo(
      async () => [],
      async () => [],
    );

    const collected = await Effect.runPromise(
      LaikaStream.runCollect(repo.removeAtoms(['missing'])),
    );

    expect(collected.data).toEqual([]);
    expect(collected.done).toEqual({ removed: 0, skipped: 1 });
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
    expect(collected.recoverableErrors[0]!.message).toContain('"missing"');
  });
});
