# `@laikacms/pinata`

A [Pinata](https://www.pinata.cloud) (IPFS)-backed `StorageRepository` for Laika CMS. **The first
content-addressed backend in the suite** — every other storage backend is path-addressed (S3, R2,
WebDAV, Dropbox), id-addressed (Drive, Firestore, Notion), or filter-indexed (Algolia, DDB, D1,
PocketBase). IPFS hashes content into a CID, so the same content always has the same address and
there's no such thing as an "update" — only a new pin.

Runtime-agnostic — only depends on `fetch`.

## `@laikacms/pinata/storage-ipfs`

```ts
import { PinataStorageRepository } from '@laikacms/pinata/storage-ipfs';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const repo = new PinataStorageRepository({
  auth: { token: process.env.PINATA_JWT! },
  gatewayUrl: 'https://your-dedicated-gateway.mypinata.cloud/ipfs', // optional
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});
```

### The interesting bit — copy-on-write updates

Every other backend in the suite mutates a stable address in place. IPFS can't — the CID _is_ the
content hash. So `updateObject` is a two-step copy-on-write:

```
1. Pin new content                            → returns new CID
2. Unpin every old CID with the same `metadata.name`
```

Between (1) and (2) there's a brief window where Pinata's `pinList` index returns **both** CIDs. The
repository sorts by `date_pinned` and always picks the newest — verified by a dedicated test that
hand-constructs the dual-pin state and confirms `getObject` returns the newer content.

### The mutable name-index sitting on top

CIDs are immutable; storage keys aren't. The mutable mapping lives in each pin's metadata:

```
metadata.name                      = storage path (e.g. "notes/hello.md")
metadata.keyvalues.type            = 'file' | 'folder'
metadata.keyvalues.parent          = parent folder path
metadata.keyvalues.extension       = on-server file extension (files only)
metadata.keyvalues.path            = full key without the extension
```

Reads search `pinList` by `metadata[name]` (exact match) or `metadata[keyvalues]` (operator-based).
Pinata's search is the index over content that IPFS can't provide natively.

### Operation cost

| Operation                   | API calls                                                                    |
| --------------------------- | ---------------------------------------------------------------------------- |
| `getObject`                 | one `pinList` search per registered extension (parallel) + one gateway fetch |
| `getFolder`                 | one `pinList` search                                                         |
| `listAtomSummaries(folder)` | one `pinList` search with `metadata[keyvalues].parent` filter                |
| `createObject`              | one `pinFileToIPFS` per file + one per missing ancestor folder               |
| `updateObject`              | one `pinFileToIPFS` + one `unpin` (the COW pair)                             |
| `removeAtoms`               | one `pinList` per key (resolve) + one `unpin` per old CID                    |

### Trade-offs

- **Eventual consistency on metadata search.** Pinata's `pinList` index updates within seconds but
  not synchronously with the pin call. If you read immediately after writing, you may see the
  previous CID. The repository doesn't paper over this — if you need read-your-writes, layer a small
  client-side cache.
- **No OCC.** No version counter. Concurrent writers race.
- **Garbage collection is on you.** Unpinning is best-effort; old content may stay retrievable
  through public gateways for a while. Pinata's billing meters the _pinned_ size, so unpinning
  eventually stops paying — but the data isn't gone.
- **Public IPFS visibility.** Anything pinned is retrievable by anyone who knows the CID. Treat all
  content as roughly public, even with a private gateway.
- **Dedicated gateway recommended.** The public `gateway.pinata.cloud/ipfs/<cid>` is rate-limited;
  provision a dedicated gateway and configure `gatewayUrl` for production.

### Errors

| HTTP | Laika error               |
| ---- | ------------------------- |
| 401  | `AuthenticationError`     |
| 403  | `ForbiddenError`          |
| 404  | `NotFoundError`           |
| 429  | `TooManyRequestsError`    |
| 5xx  | `ServiceUnavailableError` |

### What this is good for

- **Decentralised storage with familiar semantics.** Files live on IPFS — pinned via Pinata so you
  have an SLA, but anyone with the CID can verify the bytes against the hash. Useful for content you
  want to make publicly archivable.
- **Tamper-evident content.** The CID is the content hash; you can hand someone a CID and they'll
  know whether the bytes they got match. Useful for things like signed documents, build artifacts,
  public datasets.
- **NFT / web3 use cases.** Pinata is the conventional storage layer; this gives you the Laika
  authoring surface on top.
