# @laikacms/etcd

[etcd](https://etcd.io/)-backed implementations of Laika CMS contracts.
First (and current) export: **`@laikacms/etcd/storage-etcd`** — a
`StorageRepository` over the etcd v3 gRPC JSON gateway.

Runtime-agnostic — only depends on `fetch`. Works on Node, Bun,
Cloudflare Workers, Deno, and the browser.

```bash
pnpm add @laikacms/etcd
```

## Why an etcd package

etcd is Kubernetes' backing store — strongly consistent, MVCC, and
linearisable. Three traits set it apart from every other backend in the
Laika suite:

1. **Base64-encoded keys/values on the wire.** etcd's gRPC gateway is
   JSON-over-HTTP but every `key` and `value` field is base64'd. This
   isn't documented loudly; the gateway just rejects raw strings with
   an opaque error. The data source wraps every key/value crossing the
   boundary with `b64encode` / `b64decode`. **First backend in the suite
   with a binary-wire-format encoding step.**

2. **Prefix scans via `[key, range_end)` pairs.** There's no `?prefix=`
   parameter. To scan everything starting with `/notes/`, you compute
   `range_end` by incrementing the last byte (`/` → `0`); etcd then
   returns every key in `[key, range_end)`. The `prefixRangeEnd()`
   helper exposes this idiom — useful even outside the repository.

3. **`Txn` as the atomic primitive.** Every important multi-key
   operation goes through `POST /v3/kv/txn`:
   - **`createObject`** uses a CAS — `compare: createRevision == 0`
     followed by `success: [requestPut]`. Even if a concurrent writer
     beats the read-modify-write window, the Txn won't commit. This is
     genuine compare-and-set, not just OCC after the fact (CouchDB).
   - **`removeAtoms(N)`** packs N `requestDeleteRange` ops into one
     `Txn.success` array. etcd commits all-or-nothing — one HTTP request
     regardless of N. **The 7th structurally distinct atomic-multi-write
     mechanism in the suite.**

Plus etcd surfaces real MVCC revisions (`create_revision`,
`mod_revision`, `version`) per key, which we plumb into
`metadata.revisionId`.

## Usage

```ts
import {
  EtcdDataSource,
  EtcdStorageRepository,
} from '@laikacms/etcd/storage-etcd';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const dataSource = new EtcdDataSource({
  url: 'http://etcd:2379',
  // Optional — etcd v3 supports unauthenticated by default. For
  // production, run `POST /v3/auth/authenticate` first to get a token.
  auth: { token: process.env.ETCD_TOKEN },
});

const repo = new EtcdStorageRepository({
  dataSource,
  basePath: '/laika',                  // virtual prefix
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## Key layout

```
/<basePath>/d/<full-path>            ← folder marker
/<basePath>/f/<full-path>.<ext>      ← file
```

Encoding the type as a path segment (`/d/` vs `/f/`) prevents the
classic name-collision problem where a folder named `notes` and a
file at `notes` would map to the same key. It also means a single
prefix scan recovers all files (`/<base>/f/`) or all folders
(`/<base>/d/`).

## Operation mapping

| Laika operation             | etcd call(s)                                                |
|-----------------------------|-------------------------------------------------------------|
| `getObject(key)`            | 1 × `POST /v3/kv/range` (prefix scan `/<f>/<key>.`)         |
| `createObject(key, …)`      | 1 × `range` (probe) + 1 × `txn` (CAS create)                |
| `updateObject(key, …)`      | 1 × `range` (read rev) + 1 × `put`                          |
| `createOrUpdateObject`      | 1 × `range` + 1 × `put`                                     |
| `createFolder(key)`         | 1 × `range` (probe) + 1 × `put` if missing                  |
| `removeAtoms([k₁…kₙ])`      | n × `range` (resolve) + **1 × `txn` with N delete ops**     |
| `listAtomSummaries(folder)` | 2 × `range` (one over `/d/<folder>/`, one over `/f/<folder>/`) |
| `getCapabilities()`         | (no I/O — static)                                           |

## Auth

etcd's gateway accepts a token via `Authorization: <token>` (no Bearer
prefix). The token comes from `POST /v3/auth/authenticate`. The data
source supports the token directly or via an async provider:

```ts
new EtcdDataSource({
  url: BASE,
  auth: {
    token: process.env.ETCD_TOKEN,
    // ...or:
    tokenProvider: async () => fetchTokenFromVault(),
    headers: { 'X-Tenant-Id': 'site-a' },  // any extras
  },
});
```

Token expiration handling lives outside this layer — wrap
`tokenProvider` in your own caching/refresh logic.

## Caveats

- **Range scans bring back every descendant.** etcd has no
  client-side delimiter; `listAtomSummaries` reconstructs the
  immediate-children view by partitioning each key's tail on `/`.
  Same big-O cost as Vercel Blob / Cloudflare Images — keep folder
  depth shallow if listings are hot.
- **No streaming yet.** etcd's watch streams (server-side change
  feeds) would be a natural fit for a future `subscribe()` method but
  aren't surfaced here.
- **Single-key reads cost one prefix scan.** Because the file
  extension lives in the key tail, we can't `GET /v3/kv/range` a
  single key directly without knowing the extension. We instead
  prefix-scan `/<f>/<key>.` and pick the first matching extension.
  Same big-O as every other extension-free-key backend, just a
  different shape.
- **Don't pass raw binary keys.** The data source assumes UTF-8 — keys
  cross through `TextEncoder` / `TextDecoder`. etcd permits arbitrary
  bytes; if you need them, encode out-of-band and round-trip via the
  raw `dataSource.put` / `get` (also exported).
