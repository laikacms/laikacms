# @laikacms/couchdb

[Apache CouchDB](https://couchdb.apache.org/)-backed implementations of Laika CMS contracts. First
(and current) export: **`@laikacms/couchdb/storage-couchdb`** — a `StorageRepository` over the
CouchDB HTTP API. Works against Apache CouchDB, IBM Cloudant, and any CouchDB-protocol-compatible
store.

Runtime-agnostic — only depends on `fetch`. Works on Node, Bun, Cloudflare Workers, Deno, and the
browser.

```bash
pnpm add @laikacms/couchdb
```

## Why a CouchDB package

CouchDB has architectural choices that none of the other backends in the Laika suite share:

1. **First-class revisions (`_rev`).** Every document carries an explicit revision string. Updates
   require `If-Match: <rev>` or the body's `_rev` field; CouchDB returns **409 Conflict** when
   stale. This is the **first true OCC mechanic** in the suite — every other backend either ignores
   concurrency or exposes ETags informationally.

2. **Mango selectors.** CouchDB's JSON-based query DSL:
   ```json
   { "selector": { "parent": "notes", "type": "file" }, "limit": 1000 }
   ```
   Supports `$eq`, `$in`, `$or`, `$and`, `$regex`, and more. The repository only uses the simple
   equality forms — listing children is one Mango query.

3. **`POST /_bulk_docs` for multi-document writes.** Atomic at the document boundary, with per-doc
   success/conflict reporting in the response array. `removeAtoms(N)` lands as **two** round-trips
   regardless of N: one `POST /_find` to resolve every key's `(_id, _rev)` pair, then one
   `POST /_bulk_docs` with all `_deleted: true` markers.

## Usage

```ts
import { CouchDbDataSource, CouchDbStorageRepository } from '@laikacms/couchdb/storage-couchdb';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const dataSource = new CouchDbDataSource({
  url: 'https://example.cloudant.com/cms',
  auth: {
    basic: { username: 'admin', password: process.env.COUCH_PASSWORD! },
    // or `cookie`, `authorizationHeader`, or `headerProvider`
  },
});

const repo = new CouchDbStorageRepository({
  dataSource,
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## Document shape

Each Laika object becomes one CouchDB document; each Laika folder becomes one with `type: 'folder'`.
Doc id encodes the key (with extension for files); the `parent` field stores the containing folder
path; the `name` field stores the leaf segment (without extension).

```json
// File: key = "notes/hello"
{
  "_id":       "notes/hello.md",
  "_rev":      "1-abc…",
  "type":      "file",
  "parent":    "notes",
  "name":      "hello",
  "extension": "md",
  "content":   "..."
}

// Folder: key = "notes"
{
  "_id":    "notes",
  "_rev":   "1-def…",
  "type":   "folder",
  "parent": "",
  "name":   "notes"
}
```

## Operation mapping

| Laika operation             | CouchDB call(s)                                            |
| --------------------------- | ---------------------------------------------------------- |
| `getObject(key)`            | `POST /_find  {selector: {type, parent, name}}`            |
| `createObject(key, …)`      | `POST /_find` (probe) + `PUT /{id}`                        |
| `updateObject(key, …)`      | `POST /_find` (read rev) + `PUT /{id}` with `_rev`         |
| `createOrUpdateObject`      | (same as above, branching on the probe result)             |
| `createFolder(key)`         | `HEAD /{id}` (idempotency) + `PUT /{id}`                   |
| `removeAtoms([k₁…kₙ])`      | **1 × `POST /_find` + 1 × `POST /_bulk_docs`** — two total |
| `listAtomSummaries(folder)` | `POST /_find  {selector: {parent: folder}}`                |
| `getCapabilities()`         | (no I/O — static)                                          |

## Auth

CouchDB accepts every shape you'd expect. The data source supports each via the `auth` option:

```ts
new CouchDbDataSource({
  url: BASE,
  auth: {
    // Pick one (or pass multiple — last one wins for the Authorization header):
    basic: { username, password }, // HTTP Basic
    cookie: 'AuthSession=…', // /_session cookie
    authorizationHeader: 'Bearer <iam-token>', // Cloudant IAM, etc.
    headerProvider: async () => ({ Authorization: '…' }),
  },
});
```

## Caveats

- **The repository never builds an index.** Without a Mango index, CouchDB falls back to a slow scan
  with a warning. For production, create indexes on `parent`, on the `(type, parent, name)` tuple,
  and on `_id` (already automatic). For example:
  ```bash
  curl -X POST $BASE/_index -d '{"index": {"fields": ["parent"]}}'
  curl -X POST $BASE/_index -d '{"index": {"fields": ["type", "parent", "name"]}}'
  ```
- **`updateObject`'s OCC window.** The repository reads the current `_rev` immediately before
  writing, so most concurrent-writer cases succeed (the second writer reads the post-first-write
  rev). The narrow race between read-and-write would surface as a 409 from the PUT; the repository
  propagates that as `EntryAlreadyExistsError`. If you need stricter linearisability, do the
  read+update on the caller side and pass the expected `_rev` through.
- **`_bulk_docs` is per-doc atomic, not transactional.** One doc can succeed while another
  conflicts. `removeAtoms` exposes per-doc conflicts as recoverable errors in the stream's
  `recoverableErrors` field.
- **CouchDB bookmarks not surfaced.** Pagination uses in-memory slicing. For very large folders
  (>1000 children), add native bookmark pagination at the application layer.
