# @laikacms/mongodb

[MongoDB](https://www.mongodb.com/)-backed implementations of Laika CMS
contracts. First (and current) export:
**`@laikacms/mongodb/storage-mongodb`** — a `StorageRepository` over a
single MongoDB collection. Works against self-hosted MongoDB, MongoDB
Atlas, AWS DocumentDB, Azure Cosmos DB's Mongo API, and FerretDB.

**Driver-agnostic.** The package depends on a structural
`MongoCollectionLike` interface — five methods (`findOne`, `insertOne`,
`replaceOne`, `deleteMany`, `aggregate`). The official `mongodb` driver
satisfies it out of the box; so does the (deprecated) Atlas Data API
when wrapped in a thin shim, an HTTP gateway, or a hand-rolled mock.
No runtime dependency on `mongodb` is pulled in.

```bash
pnpm add @laikacms/mongodb
# bring your own driver:
pnpm add mongodb
```

## Why a MongoDB package

The aggregation pipeline gives this backend its distinguishing flavour:

```ts
collection.aggregate([
  { $match: { parent: 'notes' } },
  { $sort: { name: 1 } },
  { $project: { content: 0 } },   // ← load-bearing — strips the heavy body
]);
```

That `$project: {content: 0}` is the load-bearing stage. Every other
backend in the Laika suite either streams full documents back (CouchDB,
PocketBase, Sanity) or relies on a separate "summary" view (S3 / R2
list responses). Mongo's pipeline gives us a single round-trip that
returns metadata-only rows — folders of 10k documents stay bounded.

Pipeline DSL also marks the first true **staged-transformation** query
language in the suite — every prior DSL was a single selector
expression (PostgREST's `?Parent=eq.notes`, Mango's `{selector: …}`,
GROQ's `*[type == …]`), or a tree of boolean predicates (Airtable's
`AND(...)`, Hygraph's `where: …`). Mongo's `[stage, stage, stage]`
shape is structurally different — closer to LINQ or Spark than to a
classic WHERE clause.

## Usage

```ts
import { MongoClient } from 'mongodb';
import {
  MongoDataSource,
  MongoStorageRepository,
} from '@laikacms/mongodb/storage-mongodb';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const client = new MongoClient(process.env.MONGODB_URI!);
await client.connect();
const collection = client.db('cms').collection('storage');

const dataSource = new MongoDataSource({ collection });
const repo = new MongoStorageRepository({
  dataSource,
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

### Recommended indexes

The repository assumes (but does not create) these:

```js
db.storage.createIndex({ parent: 1 });
db.storage.createIndex({ type: 1, parent: 1, name: 1 }, { unique: true });
```

The `(type, parent, name)` compound index makes extension-free key
resolution (`findOne({type: 'file', parent, name})`) an indexed lookup.

## Document shape

```json
// File: key = "notes/hello"
{
  "_id":       "notes/hello.md",
  "type":      "file",
  "parent":    "notes",
  "name":      "hello",
  "extension": "md",
  "content":   "...",
  "createdAt": "2026-…",
  "updatedAt": "2026-…"
}

// Folder: key = "notes"
{
  "_id":    "notes",
  "type":   "folder",
  "parent": "",
  "name":   "notes",
  "createdAt": "2026-…",
  "updatedAt": "2026-…"
}
```

## Operation mapping

| Laika operation             | MongoDB call(s)                                              |
|-----------------------------|--------------------------------------------------------------|
| `getObject(key)`            | `findOne({type:'file', parent, name})`                       |
| `createObject(key, …)`      | `findOne` (probe) + `insertOne` (11000 → already-exists)     |
| `updateObject(key, …)`      | `findOne` + `replaceOne({_id}, …, {upsert: true})`           |
| `createOrUpdateObject`      | (same shape, branching on the probe)                         |
| `createFolder(key)`         | `findOne({_id: key})` + `insertOne(folderDoc)` if missing    |
| `removeAtoms([k₁…kₙ])`      | n × `findOne` (in parallel) + **1 × `deleteMany({_id:{$in}})`** |
| `listAtomSummaries(folder)` | **`aggregate([$match, $sort, $project:{content:0}])`**       |
| `getCapabilities()`         | (no I/O — static)                                            |

## Caveats

- **`removeAtoms` resolves keys in parallel.** N parallel `findOne`s plus
  one `deleteMany`. We could ship one batch `find({…})` with `$or` of
  every key, but for N < 100 the parallel form is wall-clock identical
  and easier to reason about. The atomic guarantee is in the single
  `deleteMany` at the end, not in the find step.
- **No transactions used.** MongoDB supports multi-document transactions
  on replica sets, but the create/update paths are single-doc operations
  where `replaceOne(…, {upsert: true})` already gives us atomic
  read-or-create. Cross-key consistency (e.g. moving a subtree) is left
  to the caller.
- **No driver pinned.** You bring your own `mongodb` driver — or any
  shim that satisfies `MongoCollectionLike`. The package keeps its
  dependency closure tiny enough for edge runtimes.
