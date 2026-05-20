# @laikacms/surrealdb

[SurrealDB](https://surrealdb.com/)-backed implementations of Laika CMS
contracts. First (and current) export:
**`@laikacms/surrealdb/storage-surrealdb`** — a `StorageRepository`
over the SurrealDB HTTP `/sql` endpoint.

Runtime-agnostic — only depends on `fetch`. Works on Node, Bun,
Cloudflare Workers, Deno, and the browser.

```bash
pnpm add @laikacms/surrealdb
```

## Why a SurrealDB package

SurrealDB is a multi-model database (documents + graph relations + KV +
relational) with several traits not yet covered in the Laika suite:

**1. Record IDs are first-class composite handles.** A record id is
`<table>:<id>` — not a `(table, id)` tuple. The SurQL idiom for safely
constructing one is `type::thing("table", $id)`; the data source emits
this in every operation that touches a specific record, so paths like
`notes/hello.md` (with slashes, dots) bind without manual escaping.

**2. NS / DB header isolation.** Namespace and database aren't part of
the URL — they're HTTP request headers (`NS:`, `DB:`). **First backend
in the Laika suite with header-based tenancy.** Multiple Laika
instances share a cluster by passing distinct (namespace, database)
pairs:

```ts
new SurrealDbDataSource({
  url: 'https://surreal.example.com',
  namespace: 'tenant-a',     // → NS: tenant-a
  database: 'cms',           // → DB: cms
  auth: { token: '...' },
});
```

**3. `BEGIN TRANSACTION; …; COMMIT TRANSACTION;` as the atomic
primitive.** SurQL statements are semicolon-delimited, so wrapping N
of them in a transaction and posting the whole string to `/sql` runs
them as one atomic batch. Returns one result envelope per statement.
**The 12th structurally distinct atomic-multi-write mechanism in the
Laika suite.**

**4. Per-statement result envelopes.** Even single-statement queries
return an array — each entry `{status, time, result}`. The data
source's `one()` helper unwraps; `transaction()` strips the
BEGIN/COMMIT envelopes and surfaces the first failing step as an
error.

## Usage

```ts
import {
  SurrealDbDataSource,
  SurrealDbStorageRepository,
} from '@laikacms/surrealdb/storage-surrealdb';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const dataSource = new SurrealDbDataSource({
  url: 'http://localhost:8000',
  namespace: 'cms_ns',
  database: 'cms_db',
  auth: {
    token: process.env.SURREAL_JWT!,
    // …or: basic: { username: 'root', password: 'root' }
    // …or: tokenProvider: async () => signInAndReturnJwt()
  },
});

const repo = new SurrealDbStorageRepository({
  dataSource,
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## Schema setup

The repository runs no DDL. Provision once via SurrealDB's CLI or REPL:

```sql
DEFINE TABLE laika_file   SCHEMALESS;
DEFINE TABLE laika_folder SCHEMALESS;

-- Optional but recommended — indexes for the common queries.
DEFINE INDEX laika_file_parent_idx ON laika_file FIELDS parent;
DEFINE INDEX laika_file_name_idx   ON laika_file FIELDS type, parent, name UNIQUE;
DEFINE INDEX laika_folder_parent_idx ON laika_folder FIELDS parent;
DEFINE INDEX laika_folder_path_idx   ON laika_folder FIELDS path UNIQUE;
```

SCHEMAFULL works too; the repository tolerates either.

## Record shape

```json
// File: key = "notes/hello"
{
  "id":        "laika_file:notes/hello.md",   // `<table>:<path>`
  "path":      "notes/hello.md",
  "parent":    "notes",
  "name":      "hello",
  "extension": "md",
  "content":   "...",
  "type":      "file",
  "createdAt": "2026-…",
  "updatedAt": "2026-…"
}

// Folder: key = "notes"
{
  "id":     "laika_folder:notes",
  "path":   "notes",
  "parent": "",
  "name":   "notes",
  "type":   "folder",
  "createdAt": "2026-…",
  "updatedAt": "2026-…"
}
```

## Operation mapping

| Laika operation             | SurQL call(s)                                                  |
|-----------------------------|----------------------------------------------------------------|
| `getObject(key)`            | 1 × `SELECT … WHERE type = "file" AND parent = ? AND name = ? LIMIT 1` |
| `createObject(key, …)`      | 1 × probe SELECT + 1 × `CREATE type::thing(...) CONTENT $value` |
| `updateObject(key, …)`      | 1 × probe + 1 × `UPDATE type::thing(...) MERGE $merge`         |
| `createOrUpdateObject`      | 1 × probe + 1 × `UPSERT type::thing(...) CONTENT $value`       |
| `createFolder(key)`         | 1 × `UPSERT type::thing("laika_folder", $path) CONTENT $value` |
| `removeAtoms([k₁…kₙ])`      | n × probe SELECT + **1 × `BEGIN TRANSACTION; DELETE …; …; COMMIT TRANSACTION;`** |
| `listAtomSummaries(folder)` | 2 × `SELECT … WHERE parent = ?` (one per table)                |
| `getCapabilities()`         | (no I/O — static)                                              |

## Var renaming across transactions

SurrealDB's HTTP API supplies query variables via the URL query string —
**globally** for the whole `POST /sql` request. If two transaction
statements both refer to `$path`, they'd see the same value. The data
source renames vars per-statement (`$path` → `$path_0` in step 0,
`$path_1` in step 1, …) before concatenating, so each step gets the
intended bindings. Verified by the
"transaction renames vars to avoid collision" test.

## Caveats

- **No `LIVE SELECT` yet.** SurrealDB supports server-side change feeds
  via `LIVE SELECT` over WebSocket. This package only uses the HTTP
  `/sql` endpoint; live queries are a future direction.
- **The repository never runs DDL.** Provision tables/indexes via your
  migration tooling. The `validateIdentifier` guard rejects table names
  containing anything outside `[A-Za-z0-9_]`.
- **`token` vs `basic` vs `tokenProvider`.** Pick whichever fits your
  auth flow. Self-hosted dev clusters typically use HTTP Basic with
  the root creds; production deployments should use a scoped token.
- **Per-statement result shape.** Each entry in the array has its own
  `{status, time, result}` envelope. Errors at the SurQL parser level
  (syntax errors, unknown tables) are caught at the HTTP layer (5xx);
  errors at the statement level (UNIQUE violations, missing record)
  return a 2xx HTTP status with `status: 'ERR'` in the envelope.
