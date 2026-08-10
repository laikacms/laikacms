---
'laikacms': minor
'@laikacms/server': major
---

Add server-arbitrated advisory document locking (ADR-007, advisory half).

Two editors opening the same entry now see the same "being edited by X" signal, arbitrated by the
backend. Previously the only implementation was a browser-local `EntryLockManager` that shared locks
between tabs of one browser, plus a `LockStore` KV in the server package whose read-check-write
acquire could let two callers both win.

**`laikacms`**

- `Lock`, `LockToken` (an opaque bearer capability), `LockOwner`, `OwnedLock`, `DEFAULT_LOCK_TTL_MS`
  and `LocksCapabilitySchema` from `laikacms/storage`.
- `LockConflictError` (code `lock_conflict`, **423 Locked**) from `laikacms/core`. 423 rather than
  409 so a client distinguishes "someone else holds this" from `VersionMismatchError`'s "the record
  moved under you" on status alone.
- `DocumentsCapabilities.locks`, carrying `scope: 'in-process' | 'shared'` and `transactional`
  rather than a bare boolean, so an in-process implementation cannot claim cross-node guarantees it
  does not have. **This is a required field**: every `DocumentsRepository` must now declare it.
- Five capability-gated methods on `DocumentsRepository` (`acquireLock`, `refreshLock`,
  `releaseLock`, `getLock`, `withDocumentLock`), each defaulting to `NotImplementedError`, so
  existing subclasses stay source-compatible.
- `InProcessLockManager` at the new `laikacms/locks/in-process` subpath: an Effect-transaction
  (`TxHashMap`) implementation whose acquire is genuinely atomic within a node. Reports
  `scope: 'in-process'`, `transactional: false`.
- `documents-api` gains `GET/POST/DELETE /locks/{key}` and `POST /locks/{key}/refresh`. A conflict
  returns 423 with the current holder in `meta.lock`.
- `documents-jsonapi-proxy` forwards all four over HTTP; 501 re-hydrates as `NotImplementedError`,
  so a caller sees one behaviour whether the gap is local or remote.

**`@laikacms/server`** (breaking)

`LaikaApiOptions.locks` and `LaikaApiOptions.locksTtlMs` are **removed**, along with `LockStore`,
`createInMemoryLockStore` and `DEFAULT_ENTRY_LOCK_TTL_MS`. `/locks` is now a thin adapter over the
documents repository and needs no wiring: it is mounted always, and answers 501 when the repository
does not support locking.

```ts
// Before
laikaApi({ documents, storage, locks: createInMemoryLockStore(), locksTtlMs: 300_000, ... })

// After: locking follows the repository's capability
laikaApi({ documents, storage, ... })
```

To keep single-node locking, delegate the five methods on your documents repository to an
`InProcessLockManager` and report `InProcessLockManager.capability`.

The API boundary still derives the lock owner from the authenticated principal and never from the
request body. Below it, the repository authorises on the token alone and needs no notion of
identity.

**Deferred:** the write-precondition ladder (`ifVersion` / `ifLockHeldBy`, enforcement-on-write).
Locks inform; nothing blocks a write yet.
