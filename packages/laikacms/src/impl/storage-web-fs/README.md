# `laikacms/storage/web-fs`

A `StorageRepository` implementation backed by the browser's **File System API** — any
`FileSystemDirectoryHandle`, whether it points into the origin-private file system (the default), a
user-picked `showDirectoryPicker()` directory (Chromium then reads and writes real on-disk files),
or an injected shim — so LaikaCMS content can be read **and written** directly in the browser with
no server involved.

The repository deliberately does not care where a handle came from. Whatever was true when the
handle was obtained may not be true when it's used: policies change, browsers change, permissions
change. So it (re-)validates permission and liveness on every operation and fails with typed,
actionable errors instead (see [Permissions](#permissions--handle-validity)).

## Why the File System API?

It is a real, hierarchical file system surface built into every modern browser. Compared to
`laikacms/storage/web` (Web `Storage`), it offers a genuine directory hierarchy (empty folders exist
without `.keep` markers), stores content as raw files readable by any other consumer of the same
directory tree, and — for origin-private roots — has far higher quota limits (typically a large
fraction of available disk, vs. ~5–10MB for Web Storage). It is **not** a general-purpose content
backend: origin-private roots are invisible to the user's real file system, user-picked directories
are gated behind revocable permission, and neither is a secret store (see
[Security](#security--data-integrity) below).

## Usage

```ts
import { jsonSerializer } from 'laikacms/serializers/json';
import { WebFsStorageRepository } from 'laikacms/storage/web-fs';

const repo = new WebFsStorageRepository({
  root: await navigator.storage.getDirectory(), // optional — this is the default, resolved lazily
  serializerRegistry: { json: jsonSerializer },
  defaultExtension: 'json',
});

const stream = repo.listAtomSummaries('', { depth: 1, pagination: { offset: 0, limit: 50 } });
```

With a user-picked directory instead (writes go straight to the user's disk in Chromium):

```ts
const repo = new WebFsStorageRepository({
  root: await showDirectoryPicker({ mode: 'readwrite' }),
  serializerRegistry: { json: jsonSerializer },
  defaultExtension: 'json',
});
```

`root` also accepts a provider function — sync or async — so an application that persists handles
(directory handles are structured-cloneable, e.g. into IndexedDB) can resolve the stored handle
lazily, including from a service worker. The repository never looks at where the handle came from;
it only validates what the handle can do right now.

### Constructor options (`WebFsStorageRepositoryOptions`)

| Option               | Required | Default                                                                                                                                          | Description                                                                                                                                                                                                                                         |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root`               | no       | `navigator.storage.getDirectory()`, resolved lazily on first use                                                                                 | A `FileSystemDirectoryHandle` from anywhere (origin-private root or subdirectory, user-picked directory, in-memory shim satisfying the same structural contract), or a provider function resolving one lazily.                                      |
| `mode`               | no       | `'readwrite'`                                                                                                                                    | Access mode passed to `queryPermission()` when the root handle exposes it. Only controls what is _queried_ — a `'read'`-granted root still fails writes at write time with a `PermissionDeniedError`.                                               |
| `serializerRegistry` | yes      | —                                                                                                                                                | Maps file extension → `StorageSerializer`, same as every other `StorageRepository`.                                                                                                                                                                 |
| `defaultExtension`   | yes      | —                                                                                                                                                | Extension used for newly created objects when no other extension is determined.                                                                                                                                                                     |
| `namespace`          | no       | `'laikacms'`                                                                                                                                     | Subdirectory chain below `root` that every operation is scoped under, so a `WebFsStorageRepository` never reads, lists, overwrites, or deletes an entry belonging to a different namespace or unrelated data in the same tree. Pass `''` for as-is. |
| `ignoreList`         | no       | same default-exclusions convention as the other storage repositories (`.keep`, `.DS_Store`, `Thumbs.db`, `desktop.ini`, `.catalog`, `.laikacms`) | Glob patterns excluded from listings.                                                                                                                                                                                                               |
| `determineExtension` | no       | `defaultDetermineExtension`                                                                                                                      | Callback overriding how the on-write extension is chosen. Same contract as the other repositories' `determineExtension`.                                                                                                                            |

## Permissions & handle validity

Before every operation the repository re-checks that the root handle is actually usable — the state
is never cached, so a mid-session revocation is caught too:

1. **The provider.** A `root` provider that throws (e.g. the application's handle lookup failed, or
   nothing is stored yet) surfaces as a typed `IllegalStateException` with the cause preserved.
2. **Permission.** `queryPermission({ mode })` is consulted when the handle exposes it. Handles
   without it (origin-private roots, engines without the permission surface) are treated as granted
   — a handle that can't be asked can't have lost permission.
3. **Liveness.** A handle can be `'granted'` yet point at a directory that was deleted or moved, or
   be a persisted handle that expired — `queryPermission` tracks permission, not existence. A cheap
   first-entry probe catches this before it can be misreported as "folder does not exist".

The repository **never calls `requestPermission()`** — that requires a user gesture and is
unavailable in service workers. Instead it fails with a typed error (all from `laikacms/core`) that
tells the application how to recover:

| Error                           | Meaning                                                                  | Recovery                                                                     |
| ------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `PermissionPromptRequiredError` | Permission lapsed back to `'prompt'` (common for handles reused later).  | Call `handle.requestPermission({ mode })` inside a user gesture, then retry. |
| `PermissionDeniedError`         | Access was refused, or revoked mid-session (also: writes on read grant). | The user must grant access anew.                                             |
| `StaleHandleError`              | The directory is gone (deleted/moved) or the persisted handle expired.   | Have the user pick the directory again and replace the handle they stored.   |

A mid-operation `NotAllowedError`/`SecurityError` `DOMException` also maps to
`PermissionDeniedError` rather than leaking as a raw exception.

### SSR safety

`root` is optional. When omitted, `navigator.storage.getDirectory()` is resolved **lazily**, on the
first operation that actually needs it — never at construction or import time — so a
`WebFsStorageRepository` can be constructed (though not yet _used_) during SSR. If no `root` option
is supplied and the origin-private file system is unavailable when an operation runs (SSR, or an
insecure browsing context), it fails with a typed `IllegalStateException` rather than a raw
`ReferenceError`.

### In-memory shim for tests

This package's source (`src/impl/storage-web-fs/testing.ts`, not part of the public
`laikacms/storage/web-fs` export surface) provides an `InMemoryWebFsDirectoryHandle` class
implementing the minimal directory-handle contract, so `WebFsStorageRepository` can be driven in
Node without a browser, plus an `InMemoryPickedDirectoryHandle` that adds the permission and
staleness failure modes of reused user-picked handles. They feed the shared `StorageRepository`
contract-test suite and the permission-gate tests for this implementation; write your own equivalent
shim (or pass a real `FileSystemDirectoryHandle`) when testing consumer code from outside this
package.

## Security & data integrity

Everything a directory handle reaches is **readable and writable by any script that obtains the same
handle** — an origin-private root by every script on the origin, a user-picked directory by every
other program on the machine. There is no access control of its own, and every write it accepts is
inherently unauthenticated (there is no server in the loop to check who's writing). Never store
credentials, API keys, or other secrets in a `WebFsStorageRepository`. Authorization for
client-writable content belongs on a server proxy path (e.g. `laikacms/storage/jsonapi-proxy`), not
in this repository. For origin-private roots the browser may also evict data under storage pressure
unless the origin holds
[persistent storage](https://developer.mozilla.org/docs/Web/API/StorageManager/persist) permission —
treat it as a cache or local-first working copy, not a system of record.

## Behaviour notes

- **Real hierarchy, nothing simulated.** Folders are real directories: empty folders exist (and list
  as empty) without `.keep` markers, and object contents are stored as raw files — readable by any
  other consumer of the same directory tree — rather than JSON envelopes.
- **Namespacing.** Every operation is scoped under a real `namespace` subdirectory so distinct
  repositories can share one root (or a directory tree with unrelated app data) without colliding.
- **Extension hiding.** Keys are extension-free at the boundary. The on-write extension is chosen
  via `determineExtension` (default: `metadata.extension ?? defaultExtension`) and looked up on read
  by probing each registered serializer extension.
- **Timestamps.** The File System API keeps a single timestamp per file (`lastModified`), so
  `createdAt` falls back to the last modification — the same degradation `storage-fs` applies on
  filesystems without a birth time. Directories expose no timestamps at all; folder timestamps are
  synthesized.
- **Deletion is conservative.** `removeAtoms` deletes objects and _empty_ folders; deleting a folder
  with content is refused with a recoverable `ForbiddenError` (mirrors `storage-fs`).
- **Listings on missing folders** are reported as `recoverableErrors` (a `NotFoundError`), matching
  every other `StorageRepository` implementation.
- **Pagination.** Cursor pagination is not supported — offset and page styles are emulated in memory
  over a natural-order sort of the full listing.

## What this does not do

- No server round-trip, no auth, no shared/multi-user storage — everything lives behind one
  directory handle.
- No permission prompting — the application owns the `requestPermission()` gesture; the repository
  only reports, typed, what it needs.
- No streaming reads/writes — content is read and written as whole strings (writes go through
  `FileSystemFileHandle.createWritable`, which every evergreen browser now ships on the main thread;
  `createSyncAccessHandle`/workers are not used).
- No change feeds — `getCapabilities().changes` reports unsupported.
