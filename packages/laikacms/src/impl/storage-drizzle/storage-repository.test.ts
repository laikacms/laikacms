import * as Effect from 'effect/Effect';
import { describe, expect, it } from 'vitest';

import { InternalError, LaikaStream } from 'laikacms/core';

import {
  type DrizzleStorageCallbacks,
  type DrizzleStorageQueryBuilders,
  DrizzleStorageRepository,
  type StorageModel,
} from './storage-repository.js';

type Cond = { kind: 'eq', key: string };

const makeRepo = (deleteOverride: DrizzleStorageCallbacks['delete']) => {
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
    async select() {
      return [];
    },
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
});
