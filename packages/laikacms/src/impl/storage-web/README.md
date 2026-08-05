# `laikacms/storage/web`

A `StorageRepository` implementation backed by an injectable Web `Storage` object — `localStorage`,
`sessionStorage`, or an in-memory shim — so LaikaCMS content can be read **and written** directly in
the browser with no server involved.

## Why Web Storage?

Web `Storage` is available in every browser with no setup, which makes it useful for local-first
editing, demos, and tests that need a real `StorageRepository` without standing up a backend. It is
**not** a general-purpose content backend: it's per-origin, capped at a few MB, and — critically —
**not a secret store** (see [Security](#security--data-integrity) below).

## Usage

```ts
import { jsonSerializer } from 'laikacms/serializers/json';
import { WebStorageRepository } from 'laikacms/storage/web';

const repo = new WebStorageRepository({
  storage: window.localStorage, // optional — defaults to globalThis.localStorage, resolved lazily
  serializerRegistry: { json: jsonSerializer },
  defaultExtension: 'json',
});

const stream = repo.listAtomSummaries('', { depth: 1, pagination: { offset: 0, limit: 50 } });
```

### Constructor options (`WebStorageRepositoryOptions`)

| Option               | Required | Default                                                                                                                                              | Description                                                                                                                                                                                                                                                 |
| -------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`            | no       | `globalThis.localStorage`, resolved lazily on first use                                                                                              | Any object implementing the Web `Storage` interface (`getItem`, `setItem`, `removeItem`, `key`, `length`, `clear`) — `localStorage`, `sessionStorage`, or an in-memory shim for testing/SSR.                                                                |
| `serializerRegistry` | yes      | —                                                                                                                                                    | Maps file extension → `StorageSerializer`, same as every other `StorageRepository`.                                                                                                                                                                         |
| `defaultExtension`   | yes      | —                                                                                                                                                    | Extension used for newly created objects when no other extension is determined.                                                                                                                                                                             |
| `namespace`          | no       | `'laikacms'`                                                                                                                                         | Prefix every physical Web Storage key is namespaced under (`${namespace}:${key}`), so a `WebStorageRepository` never reads, lists, overwrites, or deletes a key belonging to a different namespace or unrelated data already present in the same `Storage`. |
| `ignoreList`         | no       | same default-exclusions convention as the other storage repositories (`.keep`, `.DS_Store`, `Thumbs.db`, `desktop.ini`, `.contentbase`, `.laikacms`) | Glob patterns excluded from listings.                                                                                                                                                                                                                       |
| `determineExtension` | no       | `defaultDetermineExtension`                                                                                                                          | Callback overriding how the on-write extension is chosen. Same contract as the other repositories' `determineExtension`.                                                                                                                                    |

### SSR safety

`storage` is optional. When omitted, `globalThis.localStorage` is resolved **lazily**, on the first
operation that actually needs it — never at construction or import time — so a
`WebStorageRepository` can be constructed (though not yet _used_) during SSR. If no `storage` option
is supplied and no `globalThis.localStorage` exists when an operation runs, it fails with a typed
`IllegalStateException` rather than a raw `ReferenceError`.

### In-memory shim for tests

This package's source (`src/impl/storage-web/testing.ts`, not part of the public
`laikacms/storage/web` export surface) provides an `InMemoryWebStorage` class implementing the Web
`Storage` interface, so `WebStorageRepository` can be driven in Node without a DOM. It's what feeds
the shared `StorageRepository` contract-test suite for this implementation; write your own
equivalent shim (or just pass a real `localStorage`/`sessionStorage`) when testing consumer code
from outside this package:

```ts
import { jsonSerializer } from 'laikacms/serializers/json';
import { WebStorageRepository } from 'laikacms/storage/web';

class InMemoryWebStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

const repo = new WebStorageRepository({
  storage: new InMemoryWebStorage(),
  serializerRegistry: { json: jsonSerializer },
  defaultExtension: 'json',
});
```

## Security & data integrity

The Web `Storage` API (`localStorage`/`sessionStorage`) is **world-readable to any script running on
the same origin** — it is not a secret store, has no access control of its own, and every write it
accepts is inherently unauthenticated (there is no server in the loop to check who's writing). Never
store credentials, API keys, or other secrets in a `WebStorageRepository`. Authorization for
client-writable content belongs on a server proxy path (e.g. `laikacms/storage/jsonapi-proxy`), not
in this repository.

## Behaviour notes

- **Flat store, simulated hierarchy.** Web Storage is a flat key-value store, so this repository
  simulates a hierarchical file system the same way `R2StorageRepository` does for Cloudflare R2:
  folders are represented by key prefixes (derived, not physically stored), and empty folders are
  represented by `.keep` marker entries.
- **Namespacing.** Every physical key is stored as `${namespace}:${key}` so distinct repositories
  can share one `Storage` (or one origin's storage with unrelated app data) without colliding.
- **Extension hiding.** Keys are extension-free at the boundary. The on-write extension is chosen
  via `determineExtension` (default: `metadata.extension ?? defaultExtension`) and looked up on read
  by probing each registered serializer extension.
- **Listings on missing folders** are reported as `recoverableErrors` (a `NotFoundError`), matching
  every other `StorageRepository` implementation.
- **Pagination.** Cursor pagination is not supported — offset and page styles are emulated in memory
  over a natural-order sort of the full listing.

## What this does not do

- No server round-trip, no auth, no shared/multi-user storage — everything lives in one browser
  origin's Web Storage.
- No large-object support — Web Storage is typically capped at ~5–10MB per origin across browsers.
- No streaming reads/writes — content is read and written as whole strings.
