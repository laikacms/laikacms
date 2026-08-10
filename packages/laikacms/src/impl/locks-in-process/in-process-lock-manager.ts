import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as TxHashMap from 'effect/TxHashMap';
import { LaikaTask, LockConflictError } from 'laikacms/core';
import { generateSecureRandomString } from 'laikacms/crypto';
import type { Key, Lock, LockOwner, LockToken, OwnedLock } from 'laikacms/storage';
import { DEFAULT_LOCK_TTL_MS, LockToken as LockTokenBrand, toPublicLock } from 'laikacms/storage';

/**
 * A held lock, stored with its absolute expiry in epoch milliseconds so expiry
 * is a plain numeric comparison rather than a timer we would have to manage.
 */
interface HeldLock {
  readonly key: string;
  readonly owner: LockOwner;
  readonly acquiredAtMs: number;
  readonly expiresAtMs: number;
  readonly token: LockToken;
}

export interface InProcessLockManagerOptions {
  /** Lock lifetime when the caller does not specify one. Defaults to 5 minutes. */
  defaultTtlMs?: number | undefined;
  /**
   * Clock source, injectable so tests can drive expiry deterministically
   * instead of sleeping. Defaults to `Date.now`.
   */
  now?: (() => number) | undefined;
  /**
   * Token factory. Defaults to a 32-character CSPRNG string. Tokens are bearer
   * capabilities, so this must stay unguessable; tests may override it.
   */
  generateToken?: (() => string) | undefined;
}

/**
 * Advisory lock manager held entirely in one process's memory (ADR-007).
 *
 * Every read-modify-write runs inside `Effect.tx`, so acquire is genuinely
 * atomic: two fibers racing for a free lock cannot both win, which is the bug
 * the previous read-check-write `LockStore` design could not avoid.
 *
 * That atomicity stops at the process boundary. Two nodes each get their own
 * map and each believes it holds the lock, which is exactly why the capability
 * this advertises is `scope: 'in-process'` and never `'shared'`. Use it for
 * single-node deployments and tests; a multi-node deployment needs a backend
 * whose datasource has a real conditional write.
 *
 * `transactional: false`: it brackets a lock around work, it does not roll the
 * work back.
 */
export class InProcessLockManager {
  private readonly defaultTtlMs: number;
  private readonly now: () => number;
  private readonly generateToken: () => string;
  /** Created lazily so construction stays synchronous. */
  private locks: TxHashMap.TxHashMap<string, HeldLock> | undefined;

  constructor(options: InProcessLockManagerOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_LOCK_TTL_MS;
    this.now = options.now ?? (() => Date.now());
    this.generateToken = options.generateToken ?? (() => generateSecureRandomString(32));
  }

  /** The capability this manager backs. Repositories delegating here must report exactly this. */
  static readonly capability = {
    supported: true,
    description: "Advisory locks held in this process's memory, atomic within the node via Effect transactions. "
      + 'Locks are invisible to other nodes; not safe for a multi-node deployment.',
    scope: 'in-process',
    transactional: false,
  } as const;

  private map(): Effect.Effect<TxHashMap.TxHashMap<string, HeldLock>> {
    return Effect.suspend(() => {
      if (this.locks) return Effect.succeed(this.locks);
      return Effect.map(TxHashMap.make<string, HeldLock>(), map => {
        this.locks = map;
        return map;
      });
    });
  }

  /** Read the live entry for a key, treating an expired lock as absent. */
  private liveEntry(
    map: TxHashMap.TxHashMap<string, HeldLock>,
    key: string,
    nowMs: number,
  ): Effect.Effect<HeldLock | undefined> {
    return Effect.map(TxHashMap.get(map, key), held => {
      if (Option.isNone(held)) return undefined;
      return held.value.expiresAtMs <= nowMs ? undefined : held.value;
    });
  }

  private toOwned(held: HeldLock): OwnedLock {
    return {
      key: held.key,
      owner: held.owner,
      acquiredAt: DateTime.makeUnsafe(held.acquiredAtMs),
      expiresAt: DateTime.makeUnsafe(held.expiresAtMs),
      token: held.token,
    };
  }

  acquireLock(
    key: Key,
    owner: LockOwner,
    options?: { ttlMs?: number | undefined, force?: boolean | undefined },
  ): LaikaTask.LaikaTask<OwnedLock> {
    return LaikaTask.fromEffect(
      Effect.gen({ self: this }, function*() {
        const map = yield* this.map();
        const ttlMs = options?.ttlMs ?? this.defaultTtlMs;
        const force = options?.force ?? false;

        const held = yield* Effect.tx(Effect.gen({ self: this }, function*() {
          const nowMs = this.now();
          const existing = yield* this.liveEntry(map, key, nowMs);

          // Someone else holds it and we were not told to steal it.
          if (existing && !force) return existing;

          const fresh: HeldLock = {
            key,
            owner,
            acquiredAtMs: nowMs,
            expiresAtMs: nowMs + ttlMs,
            // A force-override mints a NEW token; that is what invalidates the
            // previous holder, whose token stops matching from here on.
            token: LockTokenBrand.make(this.generateToken()),
          };
          yield* TxHashMap.set(map, key, fresh);
          return fresh;
        }));

        // Held by another owner and not forced: the caller does not get a lock.
        if (held.owner.id !== owner.id && !force) {
          return yield* Effect.fail(
            new LockConflictError(
              `Document "${key}" is locked by ${held.owner.name}.`,
            ),
          );
        }

        return { value: this.toOwned(held) };
      }),
    );
  }

  refreshLock(
    key: Key,
    token: LockToken,
    owner: LockOwner,
    options?: { ttlMs?: number | undefined },
  ): LaikaTask.LaikaTask<OwnedLock> {
    return LaikaTask.fromEffect(
      Effect.gen({ self: this }, function*() {
        const map = yield* this.map();
        const ttlMs = options?.ttlMs ?? this.defaultTtlMs;

        const outcome = yield* Effect.tx(Effect.gen({ self: this }, function*() {
          const nowMs = this.now();
          const existing = yield* this.liveEntry(map, key, nowMs);

          // Lenient: expired or never held, so revive it for this owner rather
          // than evicting an editor nobody is competing with.
          if (!existing) {
            const revived: HeldLock = {
              key,
              owner,
              acquiredAtMs: nowMs,
              expiresAtMs: nowMs + ttlMs,
              token: LockTokenBrand.make(this.generateToken()),
            };
            yield* TxHashMap.set(map, key, revived);
            return { ok: true as const, held: revived };
          }

          // Strict only where it matters: somebody else genuinely holds it.
          if (existing.token !== token) return { ok: false as const, held: existing };

          const extended: HeldLock = { ...existing, expiresAtMs: nowMs + ttlMs };
          yield* TxHashMap.set(map, key, extended);
          return { ok: true as const, held: extended };
        }));

        if (!outcome.ok) {
          return yield* Effect.fail(
            new LockConflictError(
              `Document "${key}" is now locked by ${outcome.held.owner.name}.`,
            ),
          );
        }

        return { value: this.toOwned(outcome.held) };
      }),
    );
  }

  releaseLock(key: Key, token: LockToken): LaikaTask.LaikaTask<void> {
    return LaikaTask.fromEffect(
      Effect.gen({ self: this }, function*() {
        const map = yield* this.map();

        yield* Effect.tx(Effect.gen({ self: this }, function*() {
          const existing = yield* this.liveEntry(map, key, this.now());
          // A non-matching token is a no-op, not an error: a stale client must
          // not be able to free somebody else's lock, and telling it so would
          // give it nothing useful to do.
          if (existing && existing.token === token) {
            yield* TxHashMap.remove(map, key);
          }
        }));

        return { value: undefined };
      }),
    );
  }

  getLock(key: Key): LaikaTask.LaikaTask<Lock | null> {
    return LaikaTask.fromEffect(
      Effect.gen({ self: this }, function*() {
        const map = yield* this.map();
        const existing = yield* Effect.tx(this.liveEntry(map, key, this.now()));
        return { value: existing ? toPublicLock(this.toOwned(existing)) : null };
      }),
    );
  }
}
