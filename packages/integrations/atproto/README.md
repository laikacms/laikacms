# @laikacms/atproto

[AT Protocol](https://atproto.com/)-backed implementations of Laika CMS contracts. First (and
current) export: **`@laikacms/atproto/storage-atproto`** — a `StorageRepository` over a
DID-identified repo on a PDS (Personal Data Server). Works against Bluesky's hosted PDS, self-hosted
`pds`, and any AT Protocol-compatible host.

Runtime-agnostic — only depends on `fetch`. Works on Node, Bun, Cloudflare Workers, Deno, and the
browser.

```bash
pnpm add @laikacms/atproto
```

## Why an AT Protocol package

Three architectural traits set AT Protocol apart from every other backend in the Laika suite:

**1. DID-based repo identity.** No "database name", no "bucket id" — the entire repo _is_ a DID like
`did:plc:abc...` (or `did:web:...`). Multi-tenancy is intrinsic — each tenant has their own DID. The
[atproto.repo.getRecord](https://atproto.com/specs/xrpc#getrecord) URL syntax makes this explicit:
`at://<did>/<collection>/<rkey>`.

**2. Content-addressable records.** Every record carries a CID — a SHA-256-based hash of the
canonicalised CBOR encoding. The CID changes on every update, so it doubles as both a content hash
and an OCC token via the `swapRecord` parameter. **First content-addressable backend in the suite**
— every prior backend either used monotonic counters (etcd's `mod_revision`), ETags (S3, OneDrive),
or document revs (CouchDB's `_rev`), none of which are content hashes.

**3. `applyWrites` with discriminated-union actions.** The atomic multi-record write primitive takes
an array of action objects, each tagged with a `$type` URI:

```json
{
  "writes": [
    { "$type": "com.atproto.repo.applyWrites#delete", "collection": "...", "rkey": "..." },
    { "$type": "com.atproto.repo.applyWrites#delete", "collection": "...", "rkey": "..." }
  ]
}
```

The PDS commits the whole array atomically — partial failures roll back. **The 11th structurally
distinct atomic-multi-write mechanism in the suite.**

## Usage

```ts
import { AtprotoDataSource, AtprotoStorageRepository } from '@laikacms/atproto/storage-atproto';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

// Auth: pre-acquire a session JWT via /xrpc/com.atproto.server.createSession.
const dataSource = new AtprotoDataSource({
  pdsUrl: 'https://bsky.social', // or your self-hosted PDS
  repo: 'did:plc:abc123…',
  auth: {
    accessJwt: process.env.ATPROTO_ACCESS_JWT!,
    // …or:
    tokenProvider: async () => refreshSession(),
  },
});

const repo = new AtprotoStorageRepository({
  dataSource,
  // Optional — defaults below. Custom NSIDs need a PDS that allows
  // unknown lexicons (most do, with a warning).
  fileCollection: 'com.laikacms.file',
  folderCollection: 'com.laikacms.folder',
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## Record shape

```json
// File: key = "notes/hello"
{
  "uri": "at://did:plc:abc/com.laikacms.file/notes:hello.md",
  "cid": "bafyrei…",
  "value": {
    "$type":     "com.laikacms.file",
    "path":      "notes/hello",
    "parent":    "notes",
    "name":      "hello",
    "extension": "md",
    "content":   "...",
    "createdAt": "2026-…",
    "updatedAt": "2026-…"
  }
}

// Folder: key = "notes"
{
  "uri": "at://did:plc:abc/com.laikacms.folder/notes",
  "cid": "bafyrei…",
  "value": {
    "$type":  "com.laikacms.folder",
    "path":   "notes",
    "parent": "",
    "name":   "notes",
    "createdAt": "2026-…",
    "updatedAt": "2026-…"
  }
}
```

## Path ↔ rkey encoding

AT Protocol rkeys must match `^[a-zA-Z0-9_~.:-]{1,512}$` — `/` is not allowed. The package uses `:`
(already in the allowed charset) as the path delimiter:

- Laika key `notes/hello` → rkey `notes:hello`
- Laika key `a/b/c` → rkey `a:b:c`

The exported helpers `pathToRkey()` / `rkeyToPath()` let app code do the conversion when interacting
with the underlying records directly.

## Operation mapping

| Laika operation             | AT Protocol call(s)                                                               |
| --------------------------- | --------------------------------------------------------------------------------- |
| `getObject(key)`            | N × parallel `getRecord` (one per registered extension)                           |
| `createObject(key, …)`      | N × parallel `getRecord` (probe) + 1 × `createRecord`                             |
| `updateObject(key, …)`      | N × parallel `getRecord` + 1 × `putRecord` with `swapRecord` CAS                  |
| `createOrUpdateObject`      | N × parallel `getRecord` + 1 × `putRecord`                                        |
| `createFolder(key)`         | 1 × `getRecord` (probe) + 1 × `putRecord` if missing                              |
| `removeAtoms([k₁…kₙ])`      | n × parallel `getRecord` (resolve) + **1 × `applyWrites` with N #delete actions** |
| `listAtomSummaries(folder)` | 2 × `listRecords` with `[rkeyStart, rkeyEnd)` range bound                         |
| `getCapabilities()`         | (no I/O — static)                                                                 |

## rkey range scans

AT Protocol's `listRecords` supports `rkeyStart` and `rkeyEnd` — the same `[key, range_end)` idiom
as etcd's range scan, but on the rkey alphabet. The repository uses this for subfolder listings:

```
rkeyStart = 'notes:'
rkeyEnd   = 'notes;'   // `;` is the next ASCII char after `:`
```

Verified by the "listAtomSummaries dispatches an rkey range scan" test.

## Caveats

- **The Bluesky PDS warns on unknown lexicons.** Bluesky's main PDS at `bsky.social` runs lexicon
  validation; records under `com.laikacms.*` will succeed but log a warning. Self-hosted PDSes can
  be configured to allow any NSID. For production, register your lexicon publicly via the AT
  Protocol lexicon directory.
- **No `swapRecord` on `createOrUpdate` path.** The CAS is opt-in via `updateObject`;
  `createOrUpdateObject` uses unconstrained `putRecord` for last-write-wins semantics. The 8KB
  record-size cap on the hosted PDS is the practical limit on `content` field size.
- **Custom NSIDs don't replicate via the firehose.** Records in custom collections are stored in the
  repo but the `com.atproto.sync` firehose only replicates well-known lexicons. For a CMS this is
  usually fine — federation isn't the goal — but worth knowing.
