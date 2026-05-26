# @laikacms/arangodb

[ArangoDB](https://arangodb.com/)-backed implementations of Laika CMS contracts. First (and current)
export: **`@laikacms/arangodb/storage-arangodb`** — a `StorageRepository` over the ArangoDB HTTP
API.

Runtime-agnostic — only depends on `fetch`.

```bash
pnpm add @laikacms/arangodb
```

## Why an ArangoDB package

ArangoDB is a multi-model database — the same engine stores documents, graph edges, key-value pairs,
and full-text indexes. Five wire-format choices distinguish it from every prior backend in the Laika
suite:

**1. Multi-model storage.** Documents, graph edges, and KV pairs live as collections of different
_types_ in the same database. The repository uses two `document` collections (`laika_files` and
`laika_folders`); graph-edge collections would be a future direction for linking files to their
parent folders explicitly. **First multi-model backend in the suite.**

**2. AQL — Arango Query Language.** Reads use the FOR/FILTER/RETURN list-comprehension shape:

```aql
FOR doc IN laika_files
  FILTER doc.type == @type AND doc.parent == @parent AND doc.name == @name
  LIMIT 1
  RETURN doc
```

Writes use INSERT/UPDATE/REMOVE inside the same FOR shape. AQL is structurally distinct from every
prior DSL — SQL is `SELECT ... FROM
... WHERE ...`, Mango / EdgeQL use shape literals, Cypher uses
pattern matching, SurQL is statement-delimited, Flux is functional pipelines.

**3. Database in the URL path.** `/_db/{database}/_api/cursor`,
`/_db/{database}/_api/document/{collection}/{key}`. **First backend with this convention** — other
databases that support multiple databases (Postgres, Mongo, Convex) usually put the database in the
auth context or a separate header.

**4. `_key / _id / _rev / _oldRev`** metadata convention — leading underscore for reserved fields.
`_key` is the user-facing primary key; `_id` is the qualified `<collection>/<key>` reference; `_rev`
is the server-managed optimistic-concurrency token. **First backend with this naming pattern.**

**5. Cursor-based query responses.** Every AQL response is wrapped in:

```json
{
  "result": [...],
  "hasMore": false,
  "id": "...",        // present when hasMore = true
  "cached": false,
  "extra": { "stats": {...} },
  "error": false,
  "code": 201
}
```

When `hasMore` is `true`, the data source pages through via `POST /_api/cursor/{id}` automatically.
**First backend with explicit cursor-paginated envelope.**

For atomic multi-write — **the 17th structurally distinct mechanism in the suite**: `removeAtoms(N)`
ships as ONE AQL query that traverses the bound paths and REMOVES each in a single transaction:

```aql
FOR doc IN laika_files
  FILTER doc.path IN @paths
  REMOVE doc IN laika_files
  RETURN OLD._key
```

AQL semantics: every query runs as one ACID transaction.

## Usage

```ts
import { ArangoDataSource, ArangoStorageRepository } from '@laikacms/arangodb/storage-arangodb';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const dataSource = new ArangoDataSource({
  url: 'http://arangodb:8529',
  database: 'cms',
  auth: { basic: { username: 'root', password: process.env.ARANGO_PASSWORD! } },
});

const repo = new ArangoStorageRepository({
  dataSource,
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## Schema setup

The repository assumes (but does not create) two document collections. Provision once via
`arangosh`, the web UI, or `arangoimport`:

```aql
db._create("laika_files");
db._create("laika_folders");

db.laika_files.ensureIndex({
  type: "persistent",
  fields: ["type", "parent", "name"],
  unique: true,
});
db.laika_files.ensureIndex({
  type: "persistent",
  fields: ["parent"],
});

db.laika_folders.ensureIndex({
  type: "persistent",
  fields: ["path"],
  unique: true,
});
```

The `(type, parent, name)` unique index is what makes the `EntryAlreadyExistsError` path surface a
1210 `ERROR_ARANGO_UNIQUE_CONSTRAINT_VIOLATED`.

## `_key` encoding

Arango `_key` values must match `[A-Za-z0-9_\-:.@()+,=;$!*'%]`. Slashes are reserved for `_id` (the
`collection/key` qualifier). The repository encodes `/` as `--`:

| Laika path       | `_key`             |
| ---------------- | ------------------ |
| `notes/hello.md` | `notes--hello.md`  |
| `a/b/c/deep.md`  | `a--b--c--deep.md` |

The `pathToKey` / `keyToPath` helpers are exported.

## Operation mapping

| Laika operation             | ArangoDB call(s)                                                   |
| --------------------------- | ------------------------------------------------------------------ |
| `getObject(key)`            | 1 × AQL `FOR ... FILTER ... LIMIT 1 RETURN`                        |
| `createObject(key, …)`      | 1 × probe + 1 × AQL `INSERT @doc INTO ... RETURN NEW`              |
| `updateObject(key, …)`      | 1 × probe + 1 × AQL `UPDATE @key WITH @changes IN ...`             |
| `createOrUpdateObject`      | 1 × probe + 1 × `POST /_api/document?overwriteMode=replace`        |
| `createFolder(key)`         | 1 × `POST /_api/document?overwriteMode=ignore`                     |
| `removeAtoms([k₁…kₙ])`      | n × probe + **1 × AQL `FOR ... REMOVE` traversing the path array** |
| `listAtomSummaries(folder)` | 2 × AQL `FOR ... FILTER doc.parent == @parent RETURN doc`          |
| `getCapabilities()`         | (no I/O — static)                                                  |

## Auth

```ts
new ArangoDataSource({
  url, database,
  auth: {
    basic: { username, password },        // typical self-hosted
    bearer: 'arango_cloud_jwt',           // ArangoDB Cloud / SSO
    headerProvider: async () => ({ ... }),// custom auth flow
  },
});
```

## Caveats

- **Graph edges aren't used here.** The natural multi-model fit would be edge collections linking
  `laika_files` to their parent `laika_folders`. The repository sticks to flat document collections
  with a `parent` field for simplicity. Graph traversal queries (`FOR v, e, p IN 1..3 OUTBOUND ...`)
  would be a future direction.
- **`_rev` enforcement is not enabled.** ArangoDB supports conditional writes via the `If-Match`
  header on the `_rev` token, but the repository doesn't pass it — concurrent writers stomp on each
  other. Wrap the data source to enable strict OCC if needed.
- **Collection names are interpolated, not parameterised.** AQL has no parameter syntax for
  collection names. The repository validates configured collection names against a strict regex
  (`^[A-Za-z][A-Za-z0-9_-]*$`) to prevent injection.
- **No cluster-side AQL transactions across multiple AQL queries.** Each individual AQL query is one
  transaction. For cross-query transactions, use ArangoDB's streaming transaction endpoint
  (`POST /_api/transaction/begin`) — out of scope for v1.
