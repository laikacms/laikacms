---
id: ADR-007
title: Document locking & write preconditions — repository-native, Effect, capability-graded
date: 2026-08-05
status: accepted
---

# ADR-007: Document locking & write preconditions — repository-native, Effect, capability-graded

**Date:** 2026-08-05 **Status:** Accepted **Relates to:** [[ADR-001 - realtime-collaboration]] (this
is the follow-through on its deferred "Option 2 — pessimistic locking"), [[ADR-003 -
repository-effect-boundary-convention]] (LaikaTask target style), [[ADR-006 -
cms-agnostic-protocol]] (decap is an adapter, not the owner of the mechanism)

## Context

Advisory entry-locking currently lives in `packages/decap/src/decap-api/locks.ts` as a hand-rolled
module bolted onto the Decap backend:

- a Promise-based **`LockStore`** KV interface (`get`/`set`/`delete` with a TTL argument),
- a **`LockManager`** policy class (acquire / refresh / release / get, with force-override and
  owner-guarded release), and
- **`buildLocksApi`**, an HTTP handler mounted as `/locks` on `decapApi`, wired through
  `DecapOptions.locks?: LockStore` + `locksTtlMs`.

It works, but it is unsatisfying on four axes:

1. **Not atomic.** Acquire is an explicit read-check-write against the store, so a race can let two
   acquirers both win. The code even documents this as acceptable "because it is advisory."
2. **Disconnected from the datasource.** `LockStore` is a dumb KV. A backend author (git, Postgres,
   Redis) re-implements nothing useful and — crucially — cannot use the datasource's _native_
   conditional write (`SET NX`, a git-ref CAS, a `WHERE version =` row lock). Correct multi-node
   locking is therefore impossible: the one guarantee server-arbitrated locks exist to provide is
   the one the seam forecloses.
3. **Advisory-only, no path to enforcement.** Nothing consults a lock on write.
4. **Off-island stylistically.** Promises + a thrown `LockConflict` class instead of `LaikaTask` + a
   typed `LaikaError`, so it does not compose with the rest of the pipeline and is tested
   differently.

[[ADR-001 - realtime-collaboration]] deferred real-time collaboration to post-v1.0 and named
**pessimistic locking** as the lowest-complexity path when demand materialised, to be layered "on
top of the existing `StorageRepository` interface." This ADR is that follow-through — but it
**rejects the bolt-on framing** (`_locks/` namespace, separate store) in favour of a
repository-native capability, because only a method that lives _on_ the repository can bubble up the
datasource's native transaction.

**Relevant house facts (ground-truth on `develop`, 2026-08-05):**

- `DocumentsRepository`, `StorageRepository`, `AssetsRepository` are **three independent abstract
  classes** (no inheritance). Cross-cutting capability methods (`getSyncToken` / `listChanges` /
  `subscribeChanges`) are declared per-repo, **capability-gated**, and default to
  `NotImplementedError` (the `subscribeChanges` template).
- Two token concepts already exist and are distinct:
  - **`SyncToken`** — opaque, equality-only, **per-scope** (folder/store). Powers the pull change
    feed (`getSyncToken` / `listChanges`). "A git branch head sha, a database sequence, and
    `max(updatedAt)` are all valid implementations."
  - **`revision`** (`StorageObjectMetadata.revision`, gated by `VersionTrackingCapability`) —
    opaque, equality-only, **per-record**. "A git blob/commit sha, a DB row version, an R2 ETag."
- `LaikaError` variants exist including **`VersionMismatchError`** (code `version_mismatch`, status
  **409**). There is **no** lock error yet. `LaikaError` has no generic data slot — a subclass adds
  its own fields.
- `decap-api` already holds a **`DocumentsRepository` directly** (`documents: DocumentsRepository`),
  which may itself be the `documents-jsonapi-proxy`. The repository interface is the single seam;
  decap does not care whether it is native or a proxy.
- Effect's concurrency primitives (`Ref`, STM `TRef`/`TMap`, `Semaphore`) are **in-process only**:
  real atomicity within one node, invisible across nodes.

## Decision

Locking becomes a **repository-native, capability-gated capability on `DocumentsRepository`** (the
repo Decap edits, and where per-record `revision` already lives), expressed in the established
`LaikaTask` / `LaikaError` / capability idiom. Advisory _communication_ and write _atomicity_ are
separated: the lock **informs**; the write's **precondition** enforces.

### 1. New methods on `DocumentsRepository` (shared types, Documents-only methods)

| Method                                 | Returns                   | Notes                                                                                                              |
| -------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `acquireLock(key, owner, { ttlMs? })`  | `Lock` **incl. `token`**  | default TTL **5 min** (`DEFAULT_ENTRY_LOCK_TTL_MS`); `{ force? }` overrides an existing lock and mints a new token |
| `refreshLock(key, token)`              | `Lock` incl. `token`      | **lenient**: expired/unheld → re-acquire; held by another → `LockConflictError`                                    |
| `releaseLock(key, token)`              | `void`                    | only the token-holder can release                                                                                  |
| `getLock(key)`                         | **public** `Lock \| null` | `{ key, owner:{id,name}, acquiredAt, expiresAt }` — **no `token`**                                                 |
| `withDocumentLock(key, owner)(effect)` | scoped                    | see §4                                                                                                             |

The lock **key is the document key** (`collection/slug`). Methods default to `NotImplementedError`
on the base class (the `subscribeChanges` template).

### 2. Write preconditions & the three-rung enforcement ladder

Write methods (`updateDocument` / `createDocument` / `updateUnpublished` / …) gain an **extensible**
field:

```ts
precondition?: { ifVersion?: string; ifLockHeldBy?: LockToken }
```

Each write is checked against a ladder; every rung is **independently capability-gated**:

1. **Lock rung** (`Capabilities.locks`): a write while a lock is held → **`LockConflictError`**,
   _unless_ the write presents `precondition.ifLockHeldBy` matching the held lock's token (you are
   the holder writing through your own lock). A write with no `ifLockHeldBy` fails if _any_ lock is
   held. → **The repository never needs the caller's identity; the writer _presents proof_.**
2. **Version rung** (`VersionTrackingCapability`): the write carries the base `revision` it read in
   `precondition.ifVersion`; if the object's current `revision` moved → **`VersionMismatchError`**
   (409), with `currentRevision` in `meta`.
3. **Neither supported / no precondition given**: last-write-wins, hard overwrite.

This is "the full range of options": the guarantee a deployment gets is exactly what its backend's
capabilities advertise. (Conflict _resolution_ — accept-remote vs. force-local — is **out of
scope**; the ladder only _signals_.)

### 3. Shared types & errors (in the shared/storage domain; methods stay Documents-only)

- **`Lock`** — public projection: `{ key, owner: { id, name }, acquiredAt, expiresAt }`. The
  `owner.name` is **display-only** ("being edited by Alice"); it never authorises.
- **`LockToken`** — a **branded opaque string** (equality-only, like `SyncToken`/`revision`). It is
  a **bearer capability**: whoever holds it can release the lock or write through it. Returned
  **only** to the acquirer/refresher; **never** exposed by `getLock` (see §5).
- **`LockConflictError`** — new `LaikaError`, **status 423 Locked** (deliberately distinct from the
  version rung's 409 so a client branches on status alone), carrying the current `Lock` in the
  JSON:API error's **`meta.lock`**.
- **Version rung reuses the existing `VersionMismatchError`** (409) — no new error — carrying
  `currentRevision` in `meta`.

### 4. `withDocumentLock` — scoped combinator with an overridable default

A repository method whose **default implementation is the combinator**, overridable by a backend
that has a native transaction:

- **Default:** `Effect.acquireRelease(acquireLock, releaseLock)` bracketed around the work —
  auto-releases on success, failure, _or_ fiber interruption; TTL is the crash backstop if the whole
  node dies. Mutual exclusion only; **no rollback** of partial writes.
- **Native override:** a real `BEGIN … COMMIT/ROLLBACK`. Atomic multi-write, but **session-bound**
  (dies with the connection).
- **Token threading is explicit:** `withDocumentLock(key, owner)((lock) => work(lock.token))` — the
  callback receives the `Lock`; the caller threads `lock.token` into inner writes'
  `precondition.ifLockHeldBy`. No ambient `FiberRef`/Context state.
- **Invariant (documented on the method): rollback ⇒ the call fails.** If `withDocumentLock`
  succeeds, the writes committed. On failure it propagates the _original_ error (a commit-time race
  surfaces as `VersionMismatchError`/`ConflictError`); a failed rollback keeps the root cause in the
  Effect `Cause` and never masks it.

True cross-call _unit-of-work_ transactions wrapping arbitrary repository operations are a larger
abstraction and are **out of scope**: the lock gives mutual exclusion, the per-write `precondition`
gives atomicity — the pragmatic 95% without a transaction manager.

### 5. `Capabilities.locks` — two honest axes, never a bare boolean

```ts
locks: { supported: false }
      | { supported: true; scope: 'in-process' | 'shared'; transactional: boolean }
```

- **`scope`** — `in-process` locks live in one node's memory (correct for single-node & tests,
  _silently wrong_ across nodes); `shared` locks are cross-node correct. Advertised so a multi-node
  operator sees single-node-only locks instead of discovering it in production.
- **`transactional`** — `withDocumentLock` rolls back partial writes (`true`) or brackets a lock
  without rollback (`false`). A caller needing atomic multi-write checks this and degrades/refuses
  on a bracket-only backend.

Both axes are baked in from the first commit precisely so that adding them later would _not_ be a
breaking capability change.

### 6. Implementations & wiring

- **Base:** `NotImplementedError`, `locks: { supported: false }`.
- **`InProcessLockManager`** (opt-in): STM `TMap`, TTL-aware — the "all in Effect", genuinely atomic
  default for single-node & tests → `scope: 'in-process'`, `transactional: false`.
- **Native backends** (git-ref CAS, DB row lock) override with their native atomic primitive →
  `scope: 'shared'`, optionally `transactional: true`.
- **`documents-jsonapi-proxy`** overrides the lock methods to forward over HTTP — this is the
  "communication across the JSON:API boundary via polling."
- **JSON:API surface** (mirrors `/sync-token`, `/changes` as document sub-paths):
  `GET / POST / POST …/refresh / DELETE` on `/documents/:key/lock`; `GET` returns the public `Lock`
  (no token), `POST` returns the token to the acquirer. **`meta.lock` on document reads is
  deferred** (Decap polls `getLock` explicitly; noted as a future optimisation for other API
  consumers, not silently dropped).
- **decap cleanup:** delete `LockStore`, `LockManager`, `createInMemoryLockStore`,
  `DEFAULT_ENTRY_LOCK_TTL_MS`, and the `locks` / `locksTtlMs` `DecapOptions`. The `/locks` endpoint
  becomes a thin adapter over `documents.*` lock methods, capability-gated on
  `documents.getCapabilities().locks`.

## Key design forks & rationale

- **Seam at the semantic operation, not a KV.** Moving from `LockStore` (get/set/delete) to
  `acquire/refresh/release/get` on the repository is the structural fix: each backend supplies its
  native atomic primitive. The KV seam made correct multi-node locking impossible.
- **Folded into the repository, not a sibling provider.** A `ContentBaseSettingsProvider`-style
  sibling cannot reach the datasource, so it could never bubble up a native transaction — the exact
  requirement. Change-signals (methods _on_ the repo) are the right template; the settings provider
  is the wrong one.
- **Documents-only methods, shared types.** Decap only locks documents, and `revision` lives on
  `DocumentsRepository`. Triplicating across all three repos now = 3× surface for 1 consumer; the
  change-signal triplication is a cautionary tale, not a template to copy. Shared vocabulary
  (`Lock`, `LockToken`, `LockConflictError`, capability, `precondition`) lets Assets/Storage adopt
  identical signatures later without re-derivation.
- **One primitive + a scoped combinator, not two concepts.** The advisory/session lock (decap,
  cross-request, TTL) and the processing lock (a server task, scoped, crash-safe) are the _same_
  primitive used two ways — sharing one namespace so `getLock` shows both (an editor sees a
  background job holds it, and vice versa).
- **Token, not identity, authorises.** An opaque token is unforgeable and identity-free at the repo
  seam (`presentedToken === heldLock.token`, no auth plumbing below the API), handles force-override
  cleanly (override mints a new token; a stale writer's old token fails), and doubles as the
  release/refresh capability.
- **Capabilities must not lie.** The `scope` and `transactional` axes exist so an in-process STM
  default (elegant for the deployments that fit it) can never _claim_ cross-node or transactional
  guarantees it doesn't have — the precise "looks-integrated-but-secretly-bypasses-correctness"
  failure this redesign set out to kill.

## Consequences

- **`laikacms/core` / storage-shared** gains: `Lock`, `LockToken`, `LockConflictError` (code
  `lock_conflict`, status 423), the `LocksCapability` schema, and the `precondition` struct.
  `VersionMismatchError` is reused (now carries `currentRevision` in `meta`).
- **`DocumentsRepository`** gains five methods (four abstract-with-`NotImplementedError`-default
  - `withDocumentLock` with a combinator default) and `precondition` on its write methods. Existing
    subclasses stay source-compatible (defaults throw / no-op until implemented).
- **New impl:** `InProcessLockManager` (STM). **`documents-jsonapi-proxy`** implements the lock
  methods over HTTP. Native backends opt in when a real primitive exists.
- **documents-api server** gains the `/documents/:key/lock` sub-path + actions.
- **`packages/decap`** deletes the entire `locks.ts` module and the `locks`/`locksTtlMs` options;
  `/locks` becomes an adapter over the repository, capability-gated. Advisory locks now become
  **enforced-on-write** where the backend supports it — a behaviour change from today's
  advisory-only locks (acceptable: no production users; see the project's no-back-compat stance).
- **Multi-node correctness is now _designable_, not foreclosed.** A shared/transactional backend
  drops in behind the same interface with zero caller changes.
- **Deferred:** `meta.lock` on document reads; cross-call unit-of-work transactions; lock methods on
  `StorageRepository`/`AssetsRepository`. Each is an additive, non-breaking future step because the
  shared types and capability axes are in place from the start.
- **Follow-up:** open an `LCMS-###` implementation issue with a pointer to this ADR; sequence it
  after the shared-types landing so `InProcessLockManager` and the proxy can share them.
