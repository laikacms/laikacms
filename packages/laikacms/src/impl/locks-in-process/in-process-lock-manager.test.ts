import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import type { LaikaError } from 'laikacms/core';
import { errorCode, LaikaTask } from 'laikacms/core';
import type { Key, LockOwner, LockToken } from 'laikacms/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import { InProcessLockManager } from './in-process-lock-manager.js';

const KEY = 'posts/hello' as Key;
const alice: LockOwner = { id: 'u1', name: 'Alice' };
const bob: LockOwner = { id: 'u2', name: 'Bob' };

function resolve<T>(task: LaikaTask.LaikaTask<T>): Promise<Result.Result<T, LaikaError>> {
  return LaikaTask.runPromiseResult(task);
}

async function expectOk<T>(task: LaikaTask.LaikaTask<T>): Promise<T> {
  const result = await resolve(task);
  if (Result.isFailure(result)) throw new Error(`expected success, got ${result.failure.message}`);
  return result.success;
}

async function expectLockConflict<T>(task: LaikaTask.LaikaTask<T>): Promise<LaikaError> {
  const result = await resolve(task);
  if (Result.isSuccess(result)) throw new Error('expected a LockConflictError, got success');
  expect(result.failure.code).toBe(errorCode.LOCK_CONFLICT);
  return result.failure;
}

describe('InProcessLockManager', () => {
  // A controllable clock, so expiry is exercised without sleeping.
  let nowMs: number;
  let tokenSeq: number;
  let manager: InProcessLockManager;

  beforeEach(() => {
    nowMs = 1_000_000;
    tokenSeq = 0;
    manager = new InProcessLockManager({
      defaultTtlMs: 60_000,
      now: () => nowMs,
      generateToken: () => `token-${++tokenSeq}`,
    });
  });

  describe('acquireLock', () => {
    it('grants a free lock, with a token and a TTL-derived expiry', async () => {
      const lock = await expectOk(manager.acquireLock(KEY, alice));

      expect(lock.key).toBe(KEY);
      expect(lock.owner).toEqual(alice);
      expect(lock.token).toBe('token-1');
      expect(DateTime.toEpochMillis(lock.expiresAt) - DateTime.toEpochMillis(lock.acquiredAt)).toBe(60_000);
    });

    it('refuses a lock another owner holds, naming the holder for the banner', async () => {
      await expectOk(manager.acquireLock(KEY, alice));

      const failure = await expectLockConflict(manager.acquireLock(KEY, bob));
      expect(failure.message).toContain('Alice');
    });

    it('is re-entrant for the same owner (a reopened tab must not lock its own user out)', async () => {
      await expectOk(manager.acquireLock(KEY, alice));
      const again = await expectOk(manager.acquireLock(KEY, alice));

      expect(again.owner).toEqual(alice);
    });

    it('treats an expired lock as free', async () => {
      await expectOk(manager.acquireLock(KEY, alice, { ttlMs: 1_000 }));
      nowMs += 1_001;

      const lock = await expectOk(manager.acquireLock(KEY, bob));
      expect(lock.owner).toEqual(bob);
    });

    it('force mints a NEW token, so the evicted holder cannot keep using the old one', async () => {
      const original = await expectOk(manager.acquireLock(KEY, alice));
      const stolen = await expectOk(manager.acquireLock(KEY, bob, { force: true }));

      expect(stolen.owner).toEqual(bob);
      expect(stolen.token).not.toBe(original.token);

      // Alice's stale token is now inert: it cannot release Bob's lock.
      await expectOk(manager.releaseLock(KEY, original.token));
      const stillHeld = await expectOk(manager.getLock(KEY));
      expect(stillHeld?.owner).toEqual(bob);
    });

    it('lets exactly one of many racing acquirers win', async () => {
      // The reason this manager exists: the old read-check-write LockStore
      // could let two acquirers both believe they had won.
      const contenders = Array.from({ length: 20 }, (_, i) => ({ id: `u${i}`, name: `User ${i}` }));

      const results = await Effect.runPromise(
        Effect.all(
          contenders.map(owner => Effect.result(LaikaTask.runValue(manager.acquireLock(KEY, owner)))),
          { concurrency: 'unbounded' },
        ),
      );

      expect(results.filter(Result.isSuccess)).toHaveLength(1);
      expect(results.filter(Result.isFailure)).toHaveLength(19);
    });
  });

  describe('refreshLock', () => {
    it('extends the expiry for the token-holder', async () => {
      const lock = await expectOk(manager.acquireLock(KEY, alice));
      nowMs += 30_000;

      const refreshed = await expectOk(manager.refreshLock(KEY, lock.token, alice));

      expect(DateTime.toEpochMillis(refreshed.expiresAt)).toBe(nowMs + 60_000);
      expect(refreshed.token).toBe(lock.token);
    });

    it('revives an expired lock rather than evicting an editor nobody is competing with', async () => {
      const lock = await expectOk(manager.acquireLock(KEY, alice, { ttlMs: 1_000 }));
      nowMs += 5_000;

      const revived = await expectOk(manager.refreshLock(KEY, lock.token, alice));
      expect(revived.owner).toEqual(alice);
    });

    it('acquires when nobody ever held the lock', async () => {
      const revived = await expectOk(manager.refreshLock(KEY, 'never-issued' as LockToken, alice));
      expect(revived.owner).toEqual(alice);
    });

    it('fails when somebody else now holds it, which is the case the editor must be told about', async () => {
      const lock = await expectOk(manager.acquireLock(KEY, alice, { ttlMs: 1_000 }));
      nowMs += 5_000;
      await expectOk(manager.acquireLock(KEY, bob));

      const failure = await expectLockConflict(manager.refreshLock(KEY, lock.token, alice));
      expect(failure.message).toContain('Bob');
    });
  });

  describe('releaseLock', () => {
    it('frees the lock for the token-holder', async () => {
      const lock = await expectOk(manager.acquireLock(KEY, alice));
      await expectOk(manager.releaseLock(KEY, lock.token));

      expect(await expectOk(manager.getLock(KEY))).toBeNull();
    });

    it("is a silent no-op for a non-matching token, never someone else's unlock", async () => {
      await expectOk(manager.acquireLock(KEY, alice));

      await expectOk(manager.releaseLock(KEY, 'wrong-token' as LockToken));

      const held = await expectOk(manager.getLock(KEY));
      expect(held?.owner).toEqual(alice);
    });

    it('is a no-op on a free key', async () => {
      await expectOk(manager.releaseLock(KEY, 'anything' as LockToken));
      expect(await expectOk(manager.getLock(KEY))).toBeNull();
    });
  });

  describe('getLock', () => {
    it('never leaks the bearer token', async () => {
      await expectOk(manager.acquireLock(KEY, alice));

      const held = await expectOk(manager.getLock(KEY));

      expect(held).not.toBeNull();
      expect(held).not.toHaveProperty('token');
      expect(held?.owner).toEqual(alice);
    });

    it('returns null for a free key and for an expired lock', async () => {
      expect(await expectOk(manager.getLock(KEY))).toBeNull();

      await expectOk(manager.acquireLock(KEY, alice, { ttlMs: 1_000 }));
      nowMs += 1_001;

      expect(await expectOk(manager.getLock(KEY))).toBeNull();
    });

    it('keeps separate keys independent', async () => {
      await expectOk(manager.acquireLock(KEY, alice));
      await expectOk(manager.acquireLock('posts/other' as Key, bob));

      expect((await expectOk(manager.getLock(KEY)))?.owner).toEqual(alice);
      expect((await expectOk(manager.getLock('posts/other' as Key)))?.owner).toEqual(bob);
    });
  });

  describe('capability', () => {
    it('advertises in-process, non-transactional, and never claims otherwise', () => {
      // The capability must not lie: an operator reading this sees single-node
      // locking rather than discovering it across nodes in production.
      expect(InProcessLockManager.capability.supported).toBe(true);
      expect(InProcessLockManager.capability.scope).toBe('in-process');
      expect(InProcessLockManager.capability.transactional).toBe(false);
    });
  });
});
