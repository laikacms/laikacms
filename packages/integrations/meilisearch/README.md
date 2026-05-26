# @laikacms/meilisearch

[MeiliSearch](https://www.meilisearch.com/)-backed implementations of Laika CMS contracts. First
(and current) export: **`@laikacms/meilisearch/storage-meilisearch`** — a `StorageRepository` over a
single MeiliSearch index.

Runtime-agnostic — only depends on `fetch`. Works against self-hosted MeiliSearch and MeiliSearch
Cloud.

```bash
pnpm add @laikacms/meilisearch
```

## Why a MeiliSearch package — and what's distinct from Algolia

Algolia (iter 11) is also a search engine, but MeiliSearch's wire shape differs in five concrete
ways:

**1. Async-by-default mutations via the Tasks API.** Every `PUT` / `DELETE` / `POST` that mutates
state returns immediately with `{taskUid, status: 'enqueued'}`. The data source automatically polls
`GET /tasks/{uid}` until `status === 'succeeded'` (or `'failed'`). **First backend in the suite with
the async-write-with-polling pattern**.

**2. `POST /indexes/{name}/documents/delete-batch`** — bulk delete by primary-key array, returns ONE
task uid. **The 16th structurally distinct atomic-multi-write mechanism in the suite**: async-bulk-
operation completed via task polling. The whole batch commits atomically once the task succeeds.

**3. SQL-like filter syntax** — `parent = "notes" AND type = "file"` (vs Algolia's Lucene-style
`parent:"notes" AND type:"file"`). The `eqFilter` / `andFilter` helpers build these; both are
exported.

**4. Documents have a `primaryKey` declared at index creation time.** The repository configures `id`
as the primary key, with values like `file:notes/hello.md` and `folder:notes`. Different from
Algolia's implicit `objectID` convention.

**5. Search via POST body** — `POST /indexes/{name}/search` with `{filter, q, limit}` in the JSON
body. Algolia puts these in URL query parameters.

## Usage

```ts
import { MeiliDataSource, MeiliStorageRepository } from '@laikacms/meilisearch/storage-meilisearch';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const dataSource = new MeiliDataSource({
  url: 'http://meilisearch:7700',
  auth: { apiKey: process.env.MEILI_MASTER_KEY! },
});

const repo = new MeiliStorageRepository({
  dataSource,
  indexUid: 'laika_storage',
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

The repository auto-creates the index with the right primary key and filterable attributes on first
use. No manual setup required.

## Document shape

```json
// File:
{
  "id": "file:notes/hello.md",
  "type": "file",
  "parent": "notes",
  "name": "hello",
  "extension": "md",
  "content": "...",
  "createdAt": "2026-…",
  "updatedAt": "2026-…"
}

// Folder:
{
  "id": "folder:notes",
  "type": "folder",
  "parent": "",
  "name": "notes",
  "createdAt": "2026-…",
  "updatedAt": "2026-…"
}
```

## Operation mapping

| Laika operation             | MeiliSearch call(s)                                                       |
| --------------------------- | ------------------------------------------------------------------------- |
| `getObject(key)`            | 1 × `POST /search` (filter on parent + name)                              |
| `createObject(key, …)`      | 1 × probe search + 1 × `PUT /documents` (→ task → poll)                   |
| `updateObject(key, …)`      | 1 × probe + 1 × `PUT /documents` (upsert via primary key)                 |
| `createOrUpdateObject`      | 1 × probe + 1 × `PUT /documents`                                          |
| `createFolder(key)`         | 1 × `PUT /documents` (idempotent upsert)                                  |
| `removeAtoms([k₁…kₙ])`      | n × probe search + **1 × `POST /documents/delete-batch`** (→ task → poll) |
| `listAtomSummaries(folder)` | 1 × `POST /search` (filter on parent)                                     |
| `getCapabilities()`         | (no I/O — static)                                                         |

## The Tasks API

Every mutation returns an envelope like:

```json
{
  "taskUid": 42,
  "indexUid": "laika_storage",
  "status": "enqueued",
  "type": "documentAdditionOrUpdate",
  "enqueuedAt": "…"
}
```

The data source polls `GET /tasks/42` until terminal status:

```json
{
  "uid": 42,
  "status": "succeeded",
  "type": "documentAdditionOrUpdate",
  "enqueuedAt": "…",
  "finishedAt": "…"
}
```

Configurable via `MeiliDataSourceOptions`:

```ts
new MeiliDataSource({
  url,
  auth,
  taskTimeoutMs: 30_000, // give up after 30s
  taskPollIntervalMs: 50, // poll every 50ms
});
```

A task that fails (status `'failed'`) surfaces as a Laika error with the task's `error.message` as
the cause. Failed-task error codes like `index_already_exists` map to `EntryAlreadyExistsError`.

## Auth

Provision an API key in the MeiliSearch dashboard or use the deployment's master key directly. The
master key is required for admin operations (index creation, settings changes); production
deployments should use scoped keys with just `search` / `documents.*` actions.

```ts
new MeiliDataSource({
  url,
  auth: { apiKey: process.env.MEILI_API_KEY! },
});
```

## Caveats

- **Filter must be configured.** MeiliSearch requires filterable attributes to be explicitly
  declared. The repository does this on first use
  (`PUT /indexes/{uid}/settings/filterable-attributes`), configuring `type`, `parent`, `name`,
  `extension`.
- **Tasks API has rate limits.** Aggressive polling against MeiliSearch Cloud may hit rate limits.
  The default 50ms interval is conservative; bump it up for cloud deployments.
- **No transactions across indices.** The `delete-batch` task is atomic within an index, but
  cross-index multi-write isn't supported.
- **Bulk delete's task uid covers all IDs.** If one ID is invalid, the whole task succeeds
  (MeiliSearch silently ignores missing IDs); partial failures aren't surfaced.
- **`searchableAttributes` not configured.** The repository uses filter-only access; full-text
  search isn't a use case here, so the default searchable attributes are left as-is.
