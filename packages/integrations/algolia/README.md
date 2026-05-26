# `@laikacms/algolia`

An Algolia-backed `StorageRepository` for Laika CMS. The unusual move: treat a **search index** as
the storage layer. Each Laika object becomes one Algolia record; every record you write is
immediately searchable through whatever sibling code wants to consume Algolia's query surface.

Runtime-agnostic — only depends on `fetch`. Works on Node, Bun, Deno, Cloudflare Workers, and the
browser.

## `@laikacms/algolia/storage-algolia`

```ts
import { AlgoliaStorageRepository } from '@laikacms/algolia/storage-algolia';
import { storageSerializerMarkdown } from 'laikacms/storage-serializers-markdown';

const repo = new AlgoliaStorageRepository({
  auth: {
    applicationId: process.env.ALGOLIA_APP_ID!,
    apiKey: process.env.ALGOLIA_ADMIN_API_KEY!, // admin / write key
  },
  indexName: 'laika-content',
  serializerRegistry: { md: storageSerializerMarkdown },
  defaultFileExtension: 'md',
});
```

### Record layout

Every record this repository writes carries four reserved attributes (all underscore-prefixed so
they don't collide with your content):

```
objectID   "<path>.<ext>" for files, "<path>" for folder markers
_type      "file" | "folder"
_parent    parent folder path (empty string for root)
_extension on-server file extension                              (files only)
_content   the serialized object content (string)                (files only)
_createdAt / _updatedAt   ISO timestamps
```

The repository builds these consistently so the rest of the surface (listing, find-by-extension,
delete-when-empty) becomes one-query operations.

### How operations map

| Operation                               | Algolia call                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `getObject('notes/hello')`              | parallel `GET /1/indexes/X/notes/hello.{md,json,yaml,...}` — one round-trip, bounded by serializer count              |
| `getFolder('notes')`                    | `GET /1/indexes/X/notes`, check `_type === 'folder'`                                                                  |
| `createObject` / `createOrUpdateObject` | `PUT /1/indexes/X/<objectID>` (Algolia writes are upserts; create-only is enforced client-side via a pre-flight find) |
| `removeAtoms` (file)                    | `DELETE /1/indexes/X/<objectID>`                                                                                      |
| `removeAtoms` (folder)                  | refused if non-empty (recoverable warning), else `DELETE`                                                             |
| `listAtomSummaries('notes')`            | `POST /1/indexes/X/query` with `filters=_parent:"notes"`                                                              |
| `createFolder`                          | one `PUT` per ancestor in the chain; idempotent via pre-flight check                                                  |

### The clever bit — single-query folder listing

Every prior implementation either paged through a prefix scan (S3, R2, Azure Blob, Upstash) or made
a separate request per directory level (Drive). Algolia's `filters` API gives us a true index
lookup: one HTTP call returns every direct child of a folder, both files and subfolders, **in a
single round-trip** — because every record carries a `_parent` attribute we set on write.

```
POST /1/indexes/laika-content/query
body: {"params": "filters=_parent:%22notes%22&hitsPerPage=1000&page=0"}
```

### Auth

Two headers, both required on every request:

- `X-Algolia-Application-Id: <appId>`
- `X-Algolia-API-Key:        <apiKey>`

The key determines what the repository can do. For a read-only mirror, use a **search-only** key;
the repository will still type-check but writes will fail with `AuthenticationError`. For full
read/write, use an admin or write-scoped key.

The mock in the test suite verifies that both headers are sent on every call — passing the wrong key
surfaces as `AuthenticationError` consistently.

### What this is good for

- **Pairing with full-text search.** Records you write are immediately indexed. Add a sibling search
  route that talks to the same index with a search-only key and you get search-over-content for
  free.
- **Per-tenant indexes.** Algolia's flat namespace per-app makes `indexName` per tenant trivial —
  one repository instance per tenant, distinct credentials, no cross-tenant scan risk.
- **No infra to run.** Algolia is a hosted service; this is the lowest-ops storage backend in the
  suite.

### Trade-offs

- **String values.** `_content` is a serialized string (whatever the registered serializer emits).
  Algolia stores arbitrary JSON, but to keep the storage-contract serializer model consistent we
  don't merge content fields onto the record top-level. A future "structured Algolia" mode could do
  that for search-friendliness — see Contentful for the same pattern done structurally.
- **Eventual consistency.** Algolia's writes are async — Algolia returns a `taskID` you'd `waitTask`
  against to be sure subsequent reads see your write. This repository does not wait. If your tests
  need read-after-write determinism, layer a small `dataSource.waitTask(taskID)` after each
  `putRecord` (the data source exposes `taskID` in the success result).
- **Per-record size limit** (10 KB on the default Algolia plan, configurable per-plan up to 100 KB).
  Storing large bodies via Algolia is the wrong tool — use S3 / R2 for the body and Algolia as a
  search-friendly mirror.
- **Pagination.** Cursor pagination is not exposed; offset / page styles are applied in memory after
  a natural-order sort.

### Errors

| HTTP  | Laika error                                           |
| ----- | ----------------------------------------------------- |
| 401   | `AuthenticationError`                                 |
| 403   | `ForbiddenError`                                      |
| 404   | `NotFoundError`                                       |
| 429   | `TooManyRequestsError`                                |
| 5xx   | `ServiceUnavailableError`                             |
| Other | `InternalError` (with the upstream message preserved) |
