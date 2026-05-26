# `@laikacms/sanity`

A Sanity-backed `StorageRepository` for Laika CMS via the
[Content Lake HTTP API](https://www.sanity.io/docs/http-api). **GROQ** for reads, **transactional
`/mutate`** for writes — Sanity is the first backend in the suite where every write batch commits
atomically as a single Content Lake transaction.

Runtime-agnostic — only depends on `fetch` and Web Crypto (`crypto.subtle.digest('SHA-256', …)`).

## `@laikacms/sanity/storage-sanity`

```ts
import { SanityStorageRepository } from '@laikacms/sanity/storage-sanity';
import { storageSerializerJson } from 'laikacms/storage-serializers-json';

const repo = new SanityStorageRepository({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET ?? 'production',
  auth: {
    token: process.env.SANITY_API_TOKEN!,
    // or: tokenProvider: () => refreshedToken(),
  },
  serializerRegistry: { json: storageSerializerJson },
  defaultFileExtension: 'json',
});
```

### Document layout

Two custom Sanity document types power the model:

```
_type: 'laikaFolder'   parent, name, path
_type: 'laikaObject'   parent, name, path, extension, content (serialized string)
```

Sanity's `_id` forbids `/`, so the repository derives each document's `_id` from a SHA-256 hex hash
of its full path. Override via `idFor` in the constructor if you want round-trippable /
human-readable ids.

### The two endpoints

| Direction | Endpoint                                  | What it does                                |
| --------- | ----------------------------------------- | ------------------------------------------- |
| Read      | `POST /vXXXX-XX-XX/data/query/<dataset>`  | runs a GROQ query, returns `result`         |
| Write     | `POST /vXXXX-XX-XX/data/mutate/<dataset>` | runs a **transactional batch** of mutations |

### The cleverest bit — deep keys commit in **one** transaction

Every other backend that supports nested folders either:

- writes ancestor folder markers one-by-one (DDB, Algolia, Firestore), or
- has no concept of folders (S3, R2, Azure) and uses prefix delimiters, or
- gets folders for free from a hierarchical system (Drive, Notion).

Sanity's `/mutate` accepts an _array_ of mutations. `createObject('a/b/c')` packs them as:

```
[
  { createIfNotExists: { _type: 'laikaFolder', path: 'a',   ... } },
  { createIfNotExists: { _type: 'laikaFolder', path: 'a/b', ... } },
  { create:            { _type: 'laikaObject', path: 'a/b/c', content: '...' } },
]
```

All three commit **atomically** in one HTTP request. The "deep keys + ancestor folders in a single
transaction" test verifies exactly this — a single `POST /mutate` call after a deep `createObject`.

### Optimistic concurrency via `_rev`

Sanity returns every document's `_rev` and accepts `ifRevisionID` on patches. `getObject` exposes
`_rev` as `metadata.revisionId`; `updateObject` round-trips it. Concurrent edits surface as
`VersionMismatchError`:

```ts
const obj = await LaikaTask.runPromise(repo.getObject('hello'));
// ... someone else updates the doc, _rev changes ...
await LaikaTask.runPromise(repo.updateObject({
  key: 'hello',
  content: { body: 'edited' },
  metadata: { revisionId: obj.metadata?.revisionId }, // ← rejects on stale rev
}));
```

### How operations map

| Operation                            | Sanity call                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `getObject`                          | one GROQ query: `*[_type == 'laikaObject' && parent == $p && name in [k.json, k.md, ...]]` |
| `getFolder`                          | one GROQ query: `*[_type == 'laikaFolder' && parent == $p && name == $n]`                  |
| `listAtomSummaries(folder)`          | one GROQ query: `*[(_type in [...]) && parent == $folder]`                                 |
| `createObject` / `createFolder`      | one `/mutate` with ancestor folders + the file/folder                                      |
| `updateObject`                       | one `/mutate` with `patch.ifRevisionID` for OCC                                            |
| `removeAtoms` (file or empty folder) | one `/mutate` with `{delete: {id}}`                                                        |

### Trade-offs

- **`_id` is a hash, not the path.** You can't round-trip the storage path from a raw Sanity
  document id without consulting the `path` field — by design (Sanity forbids `/` in `_id`).
  Override `idFor` if you need a different encoding.
- **No real-time listeners.** Sanity's killer feature is `listen()` for live data. The storage
  contract doesn't expose it; use Sanity's SDK directly if you need pub/sub.
- **Custom document types live in your dataset.** The repository writes `laikaObject` and
  `laikaFolder` documents alongside whatever else is in the dataset. If you have a strict schema,
  add these types (or pick types not in your studio's schema and the documents will be invisible in
  Sanity Studio but queryable via GROQ).
- **Datasets are flat.** Each repository instance addresses one dataset; multi-tenancy via separate
  datasets is straightforward.

### Errors

| HTTP | Laika error                                               |
| ---- | --------------------------------------------------------- |
| 401  | `AuthenticationError`                                     |
| 403  | `ForbiddenError`                                          |
| 404  | `NotFoundError`                                           |
| 409  | `VersionMismatchError` (mutate / patch revision mismatch) |
| 429  | `TooManyRequestsError`                                    |
| 5xx  | `ServiceUnavailableError`                                 |
