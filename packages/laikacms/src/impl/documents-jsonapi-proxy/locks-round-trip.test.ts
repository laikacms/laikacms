import * as DateTime from 'effect/DateTime';
import * as Result from 'effect/Result';
import type { LaikaError } from 'laikacms/core';
import { errorCode, LaikaTask } from 'laikacms/core';
import type { DocumentsCapabilities } from 'laikacms/documents';
import { DocumentsRepository } from 'laikacms/documents';
import type { Key, Lock, LockOwner, LockToken, OwnedLock } from 'laikacms/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowAll } from '../../shared/json-api/authorize.js';

import { buildJsonApi } from '../../api/documents-api/server.js';
import { InMemoryDocumentsRepository } from '../../domain/documents/testing/in-memory-documents.js';
import { InProcessLockManager } from '../locks-in-process/in-process-lock-manager.js';
import { DocumentsJsonApiProxyRepository } from './documents-jsonapi-proxy-repository.js';

const ORIGIN = 'http://laika-locks.test';
const KEY = 'posts/hello' as Key;
const alice: LockOwner = { id: 'u1', name: 'Alice' };
const bob: LockOwner = { id: 'u2', name: 'Bob' };

/**
 * The in-memory reference repository, with locking delegated to the in-process
 * manager. Written here rather than baked into the testing repository so the
 * `domain/` layer keeps no dependency on `impl/`.
 */
class LockingInMemoryDocuments extends InMemoryDocumentsRepository {
  readonly manager: InProcessLockManager;

  constructor(manager: InProcessLockManager) {
    super();
    this.manager = manager;
  }

  override getCapabilities(): LaikaTask.LaikaTask<DocumentsCapabilities> {
    return LaikaTask.map(super.getCapabilities(), caps => ({
      ...caps,
      locks: InProcessLockManager.capability,
    }));
  }

  override acquireLock(
    key: Key,
    owner: LockOwner,
    options?: { ttlMs?: number | undefined, force?: boolean | undefined },
  ): LaikaTask.LaikaTask<OwnedLock> {
    return this.manager.acquireLock(key, owner, options);
  }

  override refreshLock(
    key: Key,
    token: LockToken,
    owner: LockOwner,
    options?: { ttlMs?: number | undefined },
  ): LaikaTask.LaikaTask<OwnedLock> {
    return this.manager.refreshLock(key, token, owner, options);
  }

  override releaseLock(key: Key, token: LockToken): LaikaTask.LaikaTask<void> {
    return this.manager.releaseLock(key, token);
  }

  override getLock(key: Key): LaikaTask.LaikaTask<Lock | null> {
    return this.manager.getLock(key);
  }
}

function resolve<T>(task: LaikaTask.LaikaTask<T>): Promise<Result.Result<T, LaikaError>> {
  return LaikaTask.runPromiseResult(task);
}

async function expectOk<T>(task: LaikaTask.LaikaTask<T>): Promise<T> {
  const result = await resolve(task);
  if (Result.isFailure(result)) throw new Error(`expected success, got ${result.failure.message}`);
  return result.success;
}

async function expectFailureCode<T>(task: LaikaTask.LaikaTask<T>, code: string): Promise<LaikaError> {
  const result = await resolve(task);
  if (Result.isSuccess(result)) throw new Error(`expected failure ${code}, got success`);
  expect(result.failure.code).toBe(code);
  return result.failure;
}

describe('advisory locks over the JSON:API boundary', () => {
  let originalFetch: typeof fetch | null = null;
  let proxy: DocumentsJsonApiProxyRepository;
  let backing: LockingInMemoryDocuments;
  let nowMs: number;

  function serve(repo: DocumentsRepository) {
    const api = buildJsonApi({ repo, authorize: allowAll });
    originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' || input instanceof URL
          ? new URL(input.toString())
          : new URL(input.url);
        if (url.origin !== ORIGIN) {
          if (!originalFetch) throw new Error('locks stub: no original fetch');
          return originalFetch(input, init);
        }
        const req = input instanceof Request ? new Request(input, init) : new Request(url.toString(), init);
        return api.fetch(req);
      }) as typeof fetch,
    );
    return new DocumentsJsonApiProxyRepository({ baseUrl: ORIGIN });
  }

  beforeEach(() => {
    nowMs = 1_000_000;
    backing = new LockingInMemoryDocuments(
      new InProcessLockManager({ defaultTtlMs: 60_000, now: () => nowMs }),
    );
    proxy = serve(backing);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    originalFetch = null;
  });

  it('acquires a lock through the proxy and reads it back', async () => {
    const acquired = await expectOk(proxy.acquireLock(KEY, alice));
    expect(acquired.key).toBe(KEY);
    expect(acquired.owner).toEqual(alice);
    expect(acquired.token).not.toBe('');

    const held = await expectOk(proxy.getLock(KEY));
    expect(held?.owner).toEqual(alice);
  });

  it('never sends the token over the read path', async () => {
    await expectOk(proxy.acquireLock(KEY, alice));

    // Inspect the raw wire response, not just the decoded value: the token must
    // not be on the GET body at all, since polling this is how every client
    // renders the "being edited by" banner.
    const raw = await fetch(`${ORIGIN}/locks/${encodeURIComponent(KEY)}`);
    const body = await raw.json() as { data: { attributes: Record<string, unknown> } };
    expect(body.data.attributes).not.toHaveProperty('token');
    expect(body.data.attributes['owner']).toEqual(alice);
  });

  it('reports a free document as null rather than an error', async () => {
    expect(await expectOk(proxy.getLock(KEY))).toBeNull();
  });

  it('rejects a second holder with 423 and names the current holder in meta.lock', async () => {
    await expectOk(proxy.acquireLock(KEY, alice));

    const failure = await expectFailureCode(proxy.acquireLock(KEY, bob), errorCode.LOCK_CONFLICT);
    expect(failure.message).toContain('Alice');

    const raw = await fetch(`${ORIGIN}/locks/${encodeURIComponent(KEY)}`, {
      method: 'POST',
      body: JSON.stringify({ data: { type: 'lock', attributes: { owner: bob } } }),
    });
    expect(raw.status).toBe(423);
    const body = await raw.json() as { meta?: { lock?: { owner?: { name?: string } } } };
    expect(body.meta?.lock?.owner?.name).toBe('Alice');
  });

  it('refreshes a held lock through the proxy', async () => {
    const acquired = await expectOk(proxy.acquireLock(KEY, alice));
    nowMs += 30_000;

    const refreshed = await expectOk(proxy.refreshLock(KEY, acquired.token, alice));
    expect(refreshed.token).toBe(acquired.token);
    expect(DateTime.toEpochMillis(refreshed.expiresAt)).toBe(nowMs + 60_000);
  });

  it('releases a lock, freeing it for the next editor', async () => {
    const acquired = await expectOk(proxy.acquireLock(KEY, alice));
    await expectOk(proxy.releaseLock(KEY, acquired.token));

    expect(await expectOk(proxy.getLock(KEY))).toBeNull();
    await expectOk(proxy.acquireLock(KEY, bob));
  });

  it('propagates a force steal, invalidating the previous token end to end', async () => {
    const original = await expectOk(proxy.acquireLock(KEY, alice));
    const stolen = await expectOk(proxy.acquireLock(KEY, bob, { force: true }));

    expect(stolen.token).not.toBe(original.token);

    // Alice's stale token must not free Bob's lock.
    await expectOk(proxy.releaseLock(KEY, original.token));
    expect((await expectOk(proxy.getLock(KEY)))?.owner).toEqual(bob);
  });

  it('surfaces the locks capability from the backing repository', async () => {
    const caps = await expectOk(proxy.getCapabilities());
    expect(caps.locks).toEqual(InProcessLockManager.capability);
  });

  describe('when the backing repository does not support locks', () => {
    beforeEach(() => {
      vi.unstubAllGlobals();
      proxy = serve(new InMemoryDocumentsRepository());
    });

    it('simply omits the locks capability rather than declaring it unsupported', async () => {
      // A repository that does not lock says nothing; absent is the default.
      const caps = await expectOk(proxy.getCapabilities());
      expect(caps.locks).toBeUndefined();
    });

    it('fails with NotImplementedError, so a client degrades instead of guessing', async () => {
      // 501 on the wire re-hydrates into the same typed error the base class
      // raises locally: one behaviour whether the gap is local or remote.
      await expectFailureCode(proxy.getLock(KEY), errorCode.NOT_IMPLEMENTED);
      await expectFailureCode(proxy.acquireLock(KEY, alice), errorCode.NOT_IMPLEMENTED);
    });
  });
});
