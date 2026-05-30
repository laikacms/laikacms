import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { runStorageRepositoryContract } from 'laikacms/storage/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { UpstashRedisStorageRepository } from './redis-storage-repository.js';
import { upstashRedisContractCase } from './testing/index.js';

runStorageRepositoryContract(upstashRedisContractCase);

// ---------------------------------------------------------------------------
// Tiny in-memory Redis-over-HTTPS mock — handles the subset of commands the
// repository uses (GET / SET / DEL / EXISTS / SCAN) plus the `/pipeline`
// endpoint. Cursor handling is intentionally trivial: a single SCAN call
// returns every match, then signals completion with cursor `"0"`.
// ---------------------------------------------------------------------------

const URL_BASE = 'https://test.upstash.io';

/** Translate Redis glob (`*`, `?`, `[set]`) into a RegExp. */
const globToRegex = (glob: string): RegExp => {
  let pattern = '^';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') pattern += '.*';
    else if (ch === '?') pattern += '.';
    else if ('[]^$.|()+\\'.includes(ch)) pattern += '\\' + ch;
    else pattern += ch;
  }
  pattern += '$';
  return new RegExp(pattern);
};

const createMockRedis = () => {
  const store = new Map<string, string>();

  const runCommand = (cmd: ReadonlyArray<string | number>): { result?: unknown, error?: string } => {
    const op = String(cmd[0]).toUpperCase();
    switch (op) {
      case 'GET': {
        const k = String(cmd[1]);
        const v = store.get(k);
        return { result: v === undefined ? null : v };
      }
      case 'SET': {
        store.set(String(cmd[1]), String(cmd[2]));
        return { result: 'OK' };
      }
      case 'DEL': {
        let count = 0;
        for (let i = 1; i < cmd.length; i++) {
          if (store.delete(String(cmd[i]))) count += 1;
        }
        return { result: count };
      }
      case 'EXISTS': {
        let count = 0;
        for (let i = 1; i < cmd.length; i++) {
          if (store.has(String(cmd[i]))) count += 1;
        }
        return { result: count };
      }
      case 'SCAN': {
        // SCAN cursor MATCH pattern COUNT count
        const matchIdx = cmd.findIndex(x => String(x).toUpperCase() === 'MATCH');
        const pattern = matchIdx >= 0 ? String(cmd[matchIdx + 1]) : '*';
        const re = globToRegex(pattern);
        const keys = [...store.keys()].filter(k => re.test(k));
        return { result: ['0', keys] };
      }
      default:
        return { error: `unsupported command: ${op}` };
    }
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const body = init?.body ? JSON.parse(init.body as string) : [];

    if (url.pathname === '/pipeline') {
      const commands = body as ReadonlyArray<readonly (string | number)[]>;
      const results = commands.map(runCommand);
      return new Response(JSON.stringify(results), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const result = runCommand(body as readonly (string | number)[]);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return { store, fetch: fetchImpl };
};

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let redis: ReturnType<typeof createMockRedis>;

beforeEach(() => {
  redis = createMockRedis();
});
afterEach(() => {
  redis.store.clear();
});

const makeRepo = (namespace = 'laika:storage') =>
  new UpstashRedisStorageRepository({
    url: URL_BASE,
    token: 'fake-token',
    fetch: redis.fetch,
    namespace,
    serializerRegistry: {
      md: {
        format: { mediaType: 'text/markdown' } as never,
        serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
        deserializeDocumentFileContents: async raw => ({ body: raw }),
      },
    },
    defaultFileExtension: 'md',
  });

const seedFile = (path: string, body: string, ext = 'md', namespace = 'laika:storage') => {
  redis.store.set(`${namespace}:file:${path}.${ext}`, body);
};

const seedFolder = (path: string, namespace = 'laika:storage') => {
  redis.store.set(`${namespace}:folder:${path}`, '');
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UpstashRedisStorageRepository listing', () => {
  it('sorts numeric filenames naturally and strips extensions', async () => {
    seedFile('1', 'a');
    seedFile('2', 'b');
    seedFile('10', 'c');
    seedFile('11', 'd');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10', '11']);
  });

  it('classifies files as object-summary and explicit folders as folder-summary', async () => {
    seedFolder('notes');
    seedFile('notes/a', 'x');
    seedFile('top', 'y');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    const byKey = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(byKey).toEqual({ notes: 'folder-summary', top: 'object-summary' });
  });

  it('reports a missing folder as a recoverable NotFoundError', async () => {
    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('does/not/exist', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data).toEqual([]);
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('surfaces implicit subfolders when only nested files exist under them', async () => {
    seedFolder('nested');
    seedFile('nested/sub/deep', 'x');
    // No explicit folder marker for `nested/sub` — should still appear.

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('nested', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['nested/sub']);
    expect(collected.data[0].type).toBe('folder-summary');
  });
});

describe('UpstashRedisStorageRepository CRUD', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    expect(redis.store.get('laika:storage:file:hello.md')).toBe('hi');

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });
    expect(redis.store.get('laika:storage:file:hello.md')).toBe('updated');

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect(redis.store.get('laika:storage:file:hello.md')).toBeUndefined();
  });

  it('createObject ensures folder markers for deep keys via a single pipeline call', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c', content: { body: 'deep' } }),
    );

    expect(redis.store.has('laika:storage:folder:a')).toBe(true);
    expect(redis.store.has('laika:storage:folder:a/b')).toBe(true);
    expect(redis.store.has('laika:storage:file:a/b/c.md')).toBe(true);
  });

  it('rejects a second createObject for the same key', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'one' } }),
    );
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'hello', content: { body: 'two' } }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('createFolder writes a marker that subsequent listings expose', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));
    expect(redis.store.get('laika:storage:folder:notes')).toBe('');

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['notes']);
    expect(collected.data[0].type).toBe('folder-summary');
  });

  it('refuses to delete a non-empty folder (recoverable warning, not fatal)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'x' } }),
    );

    const attempt = await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes']));
    expect(attempt.data).toEqual([]);
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
    expect(redis.store.has('laika:storage:folder:notes')).toBe(true);
  });
});

describe('UpstashRedisStorageRepository multi-tenant', () => {
  it('honours `namespace` — tenants on the same Redis never see each other', async () => {
    const a = makeRepo('tenant-a:storage');
    const b = makeRepo('tenant-b:storage');

    await LaikaTask.runPromise(
      a.createObject({ type: 'object', key: 'shared', content: { body: 'a' } }),
    );
    await LaikaTask.runPromise(
      b.createObject({ type: 'object', key: 'shared', content: { body: 'b' } }),
    );

    expect(redis.store.get('tenant-a:storage:file:shared.md')).toBe('a');
    expect(redis.store.get('tenant-b:storage:file:shared.md')).toBe('b');

    const fromA = await LaikaTask.runPromise(a.getObject('shared'));
    const fromB = await LaikaTask.runPromise(b.getObject('shared'));
    expect(fromA.content).toEqual({ body: 'a' });
    expect(fromB.content).toEqual({ body: 'b' });
  });
});
