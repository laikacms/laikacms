import * as Effect from 'effect/Effect';
import { describe, expect, it } from 'vitest';

import {
  EntryAlreadyExistsError,
  ForbiddenError,
  InternalError,
  InvalidData,
  LaikaStream,
  LaikaTask,
  NotFoundError,
} from 'laikacms/core';

import {
  type DrizzleStorageCallbacks,
  type DrizzleStorageQueryBuilders,
  DrizzleStorageRepository,
  type StorageModel,
} from './storage-repository.js';

type Cond = { kind: 'eq', key: string };

const defaultQueryBuilders: DrizzleStorageQueryBuilders = {
  keyEquals: value => ({ kind: 'eq', key: value }) as Cond,
  keyStartsWith: () => ({}),
  depthLte: () => ({}),
  and: () => ({}),
};

const makeRepo = (
  deleteOverride: DrizzleStorageCallbacks['delete'],
  selectOverride?: DrizzleStorageCallbacks['select'],
) => {
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

  return new DrizzleStorageRepository({ queryBuilders: defaultQueryBuilders, callbacks });
};

const makeRepoFull = (overrides: Partial<DrizzleStorageCallbacks> = {}) => {
  const callbacks: DrizzleStorageCallbacks = {
    async insert({ values }) {
      return [{ ...values }];
    },
    async update() {
      return [];
    },
    async delete() {
      return [];
    },
    async select() {
      return [];
    },
    ...overrides,
  };
  return new DrizzleStorageRepository({ queryBuilders: defaultQueryBuilders, callbacks });
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

  it('emits ForbiddenError and counts skipped when key has children (folder prefix) — key has no own row', async () => {
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

  it('emits ForbiddenError and does NOT delete when key has its own DB row AND has children (bypass bug LCMS-204)', async () => {
    let deleteCalled = false;
    const repo = makeRepo(
      async () => {
        deleteCalled = true;
        return [row('posts/hello')];
      },
      async () => [row('posts/hello/world')],
    );

    const collected = await Effect.runPromise(
      LaikaStream.runCollect(repo.removeAtoms(['posts/hello'])),
    );

    expect(collected.data).toEqual([]);
    expect(collected.done).toEqual({ removed: 0, skipped: 1 });
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(ForbiddenError);
    expect(collected.recoverableErrors[0]!.message).toContain("'posts/hello'");
    expect(deleteCalled).toBe(false);
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

describe('DrizzleStorageRepository — getCapabilities', () => {
  it('returns a compatibilityDate string and a pagination object', async () => {
    const repo = makeRepo(async () => []);
    const caps = await LaikaTask.runPromise(repo.getCapabilities());
    expect(typeof caps.compatibilityDate).toBe('string');
    expect(caps.compatibilityDate.length).toBeGreaterThan(0);
    expect(caps.pagination).toBeDefined();
    expect(caps.pagination.supported).toBe(true);
  });
});

describe('DrizzleStorageRepository.getObject', () => {
  it('returns a StorageObject when the row exists', async () => {
    const repo = makeRepoFull({
      async select() {
        return [row('posts/hello')];
      },
    });

    const result = await LaikaTask.runPromise(repo.getObject('posts/hello'));

    expect(result.type).toBe('object');
    expect(result.key).toBe('posts/hello');
    expect(result.content).toEqual({});
  });

  it('throws NotFoundError when no row exists', async () => {
    const repo = makeRepoFull({
      async select() {
        return [];
      },
    });

    await expect(LaikaTask.runPromise(repo.getObject('missing'))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('throws InvalidData when row content is not valid JSON', async () => {
    const badRow: StorageModel = { ...row('bad'), content: 'not-json' };
    const repo = makeRepoFull({
      async select() {
        return [badRow];
      },
    });

    await expect(LaikaTask.runPromise(repo.getObject('bad'))).rejects.toBeInstanceOf(InvalidData);
  });
});

describe('DrizzleStorageRepository.updateObject', () => {
  it('calls update then fetches the updated row via getObject', async () => {
    const updateCalls: Array<{ key: string }> = [];
    const updatedRow: StorageModel = { ...row('posts/a'), content: '{"title":"New"}' };

    const repo = makeRepoFull({
      async update({ values }) {
        updateCalls.push({ key: values.content ?? '' });
        return [];
      },
      async select() {
        return [updatedRow];
      },
    });

    const result = await LaikaTask.runPromise(
      repo.updateObject({ key: 'posts/a', content: { title: 'New' } }),
    );

    expect(updateCalls).toHaveLength(1);
    expect(result.key).toBe('posts/a');
    expect(result.content).toEqual({ title: 'New' });
  });

  it('returns existing row unchanged when no content is provided', async () => {
    const repo = makeRepoFull({
      async select() {
        return [row('posts/a')];
      },
    });

    const result = await LaikaTask.runPromise(repo.updateObject({ key: 'posts/a' }));
    expect(result.key).toBe('posts/a');
  });
});

describe('DrizzleStorageRepository.createObject', () => {
  it('inserts and returns new StorageObject when key is free', async () => {
    let inserted: StorageModel | undefined;
    const repo = makeRepoFull({
      async select() {
        return inserted ? [inserted] : [];
      },
      async insert({ values }) {
        inserted = values;
        return [values];
      },
    });

    const result = await LaikaTask.runPromise(
      repo.createObject({ key: 'posts/new', type: 'object', content: { title: 'Hello' } }),
    );

    expect(result.type).toBe('object');
    expect(result.key).toBe('posts/new');
    expect(result.content).toEqual({ title: 'Hello' });
  });

  it('throws EntryAlreadyExistsError when key already exists', async () => {
    const repo = makeRepoFull({
      async select() {
        return [row('posts/existing')];
      },
    });

    await expect(
      LaikaTask.runPromise(
        repo.createObject({ key: 'posts/existing', type: 'object', content: { x: 1 } }),
      ),
    ).rejects.toBeInstanceOf(EntryAlreadyExistsError);
  });

  it('throws InvalidData when content is falsy', async () => {
    const repo = makeRepoFull();

    await expect(
      LaikaTask.runPromise(
        repo.createObject({ key: 'posts/no-content', type: 'object', content: undefined as never }),
      ),
    ).rejects.toBeInstanceOf(InvalidData);
  });
});

describe('DrizzleStorageRepository.createOrUpdateObject', () => {
  it('creates a new object when the key does not exist', async () => {
    let inserted: StorageModel | undefined;
    const repo = makeRepoFull({
      async select() {
        return inserted ? [inserted] : [];
      },
      async insert({ values }) {
        inserted = values;
        return [values];
      },
    });

    const result = await LaikaTask.runPromise(
      repo.createOrUpdateObject({ key: 'posts/brand-new', type: 'object', content: { v: 1 } }),
    );

    expect(result.key).toBe('posts/brand-new');
    expect(result.content).toEqual({ v: 1 });
  });

  it('updates an existing object when the key already exists', async () => {
    const existing = { ...row('posts/exists'), content: '{"v":1}' };
    const updateCalls: number[] = [];

    const repo = makeRepoFull({
      async select() {
        return [{ ...existing, content: '{"v":2}' }];
      },
      async update() {
        updateCalls.push(1);
        return [];
      },
    });

    const result = await LaikaTask.runPromise(
      repo.createOrUpdateObject({ key: 'posts/exists', type: 'object', content: { v: 2 } }),
    );

    expect(updateCalls).toHaveLength(1);
    expect(result.key).toBe('posts/exists');
    expect(result.content).toEqual({ v: 2 });
  });

  it('throws InvalidData when content is falsy', async () => {
    const repo = makeRepoFull();

    await expect(
      LaikaTask.runPromise(
        repo.createOrUpdateObject({
          key: 'posts/x',
          type: 'object',
          content: undefined as never,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidData);
  });
});

describe('DrizzleStorageRepository.createFolder', () => {
  it('inserts a .keep placeholder and returns the Folder', async () => {
    const insertedKeys: string[] = [];
    const repo = makeRepoFull({
      async insert({ values }) {
        insertedKeys.push(values.key);
        return [values];
      },
      async select() {
        return [row('blog/.keep')];
      },
    });

    const result = await LaikaTask.runPromise(repo.createFolder({ key: 'blog' }));

    expect(insertedKeys).toContain('blog/.keep');
    expect(result.type).toBe('folder');
    expect(result.key).toBe('blog');
  });
});

describe('DrizzleStorageRepository.getFolder', () => {
  it('returns Folder when children exist', async () => {
    const repo = makeRepoFull({
      async select() {
        return [row('docs/intro')];
      },
    });

    const result = await LaikaTask.runPromise(repo.getFolder('docs'));

    expect(result.type).toBe('folder');
    expect(result.key).toBe('docs');
  });

  it('throws NotFoundError when no children exist', async () => {
    const repo = makeRepoFull({
      async select() {
        return [];
      },
    });

    await expect(LaikaTask.runPromise(repo.getFolder('empty'))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('DrizzleStorageRepository.listAtoms', () => {
  it('returns atoms with done.total = emitted count when no count callback', async () => {
    const repo = makeRepoFull({
      async select() {
        return [row('blog/a'), row('blog/b')];
      },
    });

    const collected = await Effect.runPromise(
      LaikaStream.runCollect(
        repo.listAtoms('blog', { depth: 1, pagination: { limit: 20, offset: 0 } }),
      ),
    );

    expect(collected.data).toHaveLength(2);
    expect(collected.data[0]!.key).toBe('blog/a');
    expect(collected.done.total).toBe(2);
    expect(collected.recoverableErrors).toHaveLength(0);
  });

  it('uses done.total from count callback when provided', async () => {
    const repo = new DrizzleStorageRepository({
      queryBuilders: defaultQueryBuilders,
      callbacks: {
        async insert({ values }) {
          return [values];
        },
        async update() {
          return [];
        },
        async delete() {
          return [];
        },
        async select() {
          return [row('blog/a')];
        },
        async count() {
          return 42;
        },
      },
    });

    const collected = await Effect.runPromise(
      LaikaStream.runCollect(
        repo.listAtoms('blog', { depth: 1, pagination: { limit: 20, offset: 0 } }),
      ),
    );

    expect(collected.done.total).toBe(42);
  });

  it('skips keep-file rows', async () => {
    const keepRow: StorageModel = { ...row('blog/.keep'), type: 'keep-file', content: 'null' };
    const repo = makeRepoFull({
      async select() {
        return [keepRow, row('blog/post')];
      },
    });

    const collected = await Effect.runPromise(
      LaikaStream.runCollect(
        repo.listAtoms('blog', { depth: 1, pagination: { limit: 20, offset: 0 } }),
      ),
    );

    expect(collected.data).toHaveLength(1);
    expect(collected.data[0]!.key).toBe('blog/post');
  });

  it('emits recoverableError for rows with invalid JSON content', async () => {
    const badRow: StorageModel = { ...row('blog/bad'), content: 'not-json' };
    const repo = makeRepoFull({
      async select() {
        return [badRow];
      },
    });

    const collected = await Effect.runPromise(
      LaikaStream.runCollect(
        repo.listAtoms('blog', { depth: 1, pagination: { limit: 20, offset: 0 } }),
      ),
    );

    expect(collected.data).toHaveLength(0);
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(InvalidData);
  });

  it('handles page-based pagination options', async () => {
    const allRows = Array.from({ length: 3 }, (_, i) => row(`blog/p${i}`));
    const selectCalls: Array<{ limit?: number, offset?: number }> = [];

    const repo = makeRepoFull({
      async select({ limit, offset }) {
        selectCalls.push({ limit, offset });
        return allRows.slice(offset ?? 0, (offset ?? 0) + (limit ?? 20));
      },
    });

    await Effect.runPromise(
      LaikaStream.runCollect(
        repo.listAtoms('blog', { depth: 1, pagination: { page: 2, perPage: 2 } }),
      ),
    );

    expect(selectCalls[0]).toEqual({ limit: 2, offset: 2 });
  });

  it('passes limit=undefined to select callback when pagination has no limit key — returns all rows (LCMS-369)', async () => {
    const allRows = Array.from({ length: 25 }, (_, i) => row(`blog/p${i}`));
    const selectCalls: Array<{ limit?: number, offset?: number }> = [];

    const repo = makeRepoFull({
      async select({ limit, offset }) {
        selectCalls.push({ limit, offset });
        // Simulate DB returning all rows when no LIMIT clause (limit undefined)
        const start = offset ?? 0;
        return limit !== undefined ? allRows.slice(start, start + limit) : allRows.slice(start);
      },
    });

    const collected = await Effect.runPromise(
      LaikaStream.runCollect(
        repo.listAtoms('blog', { depth: 1, pagination: { offset: 0 } }),
      ),
    );

    expect(selectCalls[0]).toEqual({ limit: undefined, offset: 0 });
    expect(collected.data).toHaveLength(25);
  });
});

describe('DrizzleStorageRepository.listAtomSummaries', () => {
  it('returns object-summary items matching the atom keys', async () => {
    const repo = makeRepoFull({
      async select() {
        return [row('docs/a'), row('docs/b')];
      },
    });

    const collected = await Effect.runPromise(
      LaikaStream.runCollect(
        repo.listAtomSummaries('docs', { depth: 1, pagination: { limit: 20, offset: 0 } }),
      ),
    );

    expect(collected.data).toHaveLength(2);
    expect(collected.data[0]).toEqual({ type: 'object-summary', key: 'docs/a' });
    expect(collected.data[1]).toEqual({ type: 'object-summary', key: 'docs/b' });
    expect(collected.done.total).toBe(2);
  });
});
