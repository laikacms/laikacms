# `@laikacms/firestore`

A Firebase Firestore-backed `StorageRepository` for Laika CMS. Models storage hierarchy with **native Firestore subcollections**: every path segment becomes a Firestore document, every folder owns an `items` subcollection holding its children, so listing a folder is one native subcollection `GET` rather than a prefix scan.

Runtime-agnostic — only depends on `fetch`. Works on Node, Bun, Deno, Cloudflare Workers, and the browser. Caller owns OAuth2 refresh via an optional `tokenProvider`.

## `@laikacms/firestore/storage-firestore`

```ts
import { FirestoreStorageRepository } from '@laikacms/firestore/storage-firestore';
import { storageSerializerJson } from 'laikacms/storage-serializers-json';

const repo = new FirestoreStorageRepository({
  auth: {
    accessToken: process.env.GCP_ACCESS_TOKEN!,
    // or: tokenProvider: () => mintFreshGcpAccessToken(),
  },
  projectId: 'my-gcp-project',
  databaseId: '(default)',           // optional — Firestore default db id
  rootCollection: 'laika',           // optional — defaults to "laika"
  itemsCollection: 'items',          // optional — defaults to "items"
  serializerRegistry: { json: storageSerializerJson },
  defaultFileExtension: 'json',
});
```

### How storage paths map onto Firestore's hierarchy

Firestore alternates `collection / document / collection / document / ...`. The repository walks Laika's `/`-separated keys onto that structure verbatim:

```
Key            Wire path
""             laika                                    (collection)
hello          laika/hello                              (document)
hello/world    laika/hello/items/world                  (document)
a/b/c          laika/a/items/b/items/c                  (document)
```

So listing `a/b` is one native `GET laika/a/items/b/items` — Firestore returns the direct children only, **no client-side filtering**.

### Document layout

Each Firestore document carries three reserved fields (all written/read through the data source's typed-value helpers):

```
_type       'file' | 'folder'
_extension  on-server file extension                    (files only)
_content    serialized object content (string)          (files only)
```

Plus Firestore's automatic `createTime` / `updateTime`, which the repository surfaces as `createdAt` / `updatedAt` and `metadata.revisionId`.

### Path-segment constraint

Firestore document IDs only allow letters, digits, hyphens, underscores, and periods. Keys with characters outside `^[A-Za-z0-9._-]+$` (or matching the reserved `__*__` pattern) are rejected upfront with `BadRequestError` — better than a confusing wire-level failure later. Most realistic content paths comply already; sanitize on the way in if your editors generate human names.

### Auth setup

The repository takes a Bearer access token. You typically get one of these by:

- Minting an [OAuth2 access token](https://cloud.google.com/iam/docs/keys-create-delete) from a service-account key (`google-auth-library` or its REST equivalent).
- Using Application Default Credentials on Google's runtime infrastructure.
- Exchanging a Firebase ID token via the IAM Service Account Credentials API.

Pass it via `auth.accessToken` for short-lived scripts, or via `auth.tokenProvider` so the repository can pick up refreshed tokens transparently between calls.

### Optimistic concurrency

`metadata.revisionId` carries Firestore's `updateTime`. The data source doesn't currently round-trip `updateTime` on `PATCH` for `If-Match`-style enforcement — it's a thin layer above the existing `putDocument` if you need it (`request` already accepts arbitrary bodies). For now updates are last-writer-wins.

### Errors

| HTTP | Laika error |
|---|---|
| 401 | `AuthenticationError` |
| 403 | `ForbiddenError` |
| 404 | `NotFoundError` |
| 409 / 412 | `VersionMismatchError` |
| 429 | `TooManyRequestsError` |
| 5xx | `ServiceUnavailableError` |

### What this does not do

- No real-time listeners. Firestore's killer feature is `onSnapshot`; the storage contract doesn't expose it. Use the Firestore SDK directly if you need it.
- No transactions / batched writes. `removeAtoms` walks the input list one delete at a time; a future enhancement could route through Firestore's commit batch endpoint.
- No security-rules awareness. Whatever your Firestore security rules allow, this repository will see and respect; whatever they refuse will surface as `ForbiddenError`.
