# `laikacms/locks/in-process`

An in-process, in-memory implementation of document write-precondition locking (ADR-007). It backs
the `acquireLock` / `refreshLock` / `releaseLock` / `getLock` capability on `DocumentsRepository`
with a single class, `InProcessLockManager`, that a repository composes in.

## Why in-process locking?

It's the simplest correct implementation of the `locks` capability: every read-modify-write runs
inside `Effect.tx` (`effect/TxHashMap`), so acquiring a free lock is genuinely atomic — two fibers
racing for the same key cannot both win, which is the bug the earlier read-check-write `LockStore`
design could not avoid.

That atomicity stops at the process boundary. Two nodes each get their own map and each believes it
holds the lock — which is exactly why this manager always reports `scope: 'in-process'`, never
`'shared'`. Use it for single-node deployments and tests; a multi-node deployment needs a backend
whose datasource has a real conditional write (a git-ref CAS, a `WHERE version =` row lock, `SET
NX`,
…) and reports `scope: 'shared'` instead.

It also reports `transactional: false`: `InProcessLockManager` brackets a lock around work, it does
not roll the work back on failure.

## Usage

```ts
import { InProcessLockManager } from 'laikacms/locks/in-process';

const locks = new InProcessLockManager();

const lock = await runTask(
  locks.acquireLock('posts/hello-world', { id: 'user-1', name: 'Alice' }),
);
// lock.token is a bearer capability: whoever holds it can refresh, release, or
// (once write preconditions are enforced) write through it via `ifLockHeldBy`.

await runTask(locks.refreshLock('posts/hello-world', lock.token, { id: 'user-1', name: 'Alice' }));

await runTask(locks.releaseLock('posts/hello-world', lock.token));
```

A `DocumentsRepository` implementation typically composes an `InProcessLockManager` internally and
delegates its own lock methods to it, declaring the matching capability:

```ts
class MyDocumentsRepository extends DocumentsRepository {
  private readonly locks = new InProcessLockManager();

  acquireLock: DocumentsRepository['acquireLock'] = (key, owner, options) =>
    this.locks.acquireLock(key, owner, options);
  // ...refreshLock / releaseLock / getLock delegate the same way

  getCapabilities() {
    return { ...super.getCapabilities(), locks: InProcessLockManager.capability };
  }
}
```

### Constructor options (`InProcessLockManagerOptions`)

| Option          | Required | Default                           | Description                                                                                            |
| --------------- | -------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `defaultTtlMs`  | no       | `DEFAULT_LOCK_TTL_MS` (5 minutes) | Lock lifetime applied when a caller does not pass `ttlMs` to `acquireLock`/`refreshLock`.              |
| `now`           | no       | `() => Date.now()`                | Injectable clock source so tests can drive expiry deterministically instead of sleeping.               |
| `generateToken` | no       | 32-character CSPRNG string        | Token factory. Tokens are bearer capabilities, so overriding this must stay unguessable outside tests. |

## API

- **`acquireLock(key, owner, { ttlMs?, force? })`** — Returns the existing lock if already held by
  `owner`. Fails with `LockConflictError` if held by someone else and `force` is not set. `force`
  steals the lock and mints a **new** token, invalidating the previous holder's token.
- **`refreshLock(key, token, owner, { ttlMs? })`** — Lenient: if the lock is expired or unheld, it
  is revived for `owner` rather than treated as an error. If held by another token, fails with
  `LockConflictError`.
- **`releaseLock(key, token)`** — No-op (not an error) if `token` does not match the current holder,
  so a stale client can never free somebody else's lock.
- **`getLock(key)`** — Returns the public `Lock` projection
  (`{ key, owner, acquiredAt, expiresAt }`, **no token**) or `null` if unheld or expired.

Expired locks are treated as absent everywhere above — there is no background sweep; expiry is a
plain numeric comparison against `now()` at read time.

## Testing

`in-process-lock-manager.test.ts` covers acquire/refresh/release/force/expiry behaviour directly
against `InProcessLockManager` with an injected `now` clock, rather than relying on real timers.
