# @laikacms/libsql

[libSQL](https://turso.tech/libsql) / [Turso](https://turso.tech)-backed
implementations of Laika CMS contracts. First (and current) export:
**`@laikacms/libsql/storage-libsql`** — a `StorageRepository` over the
libSQL hrana HTTP pipeline protocol. Speaks to Turso Cloud, Fly libSQL,
and self-hosted `sqld`.

Runtime-agnostic — only depends on `fetch`. Works on Node, Bun,
Cloudflare Workers, Deno, and the browser.

```bash
pnpm add @laikacms/libsql
```

## Why a libSQL package — and why it's not just D1 again

Both libSQL and Cloudflare D1 are SQLite-over-HTTP backends, but they
differ in two structural ways:

**1. The pipeline format.** D1's HTTP API is one statement per request
(`POST /accounts/.../d1/database/{id}/query`). libSQL's is
`POST /v2/pipeline` with `{requests: [...]}` carrying N requests per
HTTP round-trip. Each request is `execute` (one statement), `batch`
(multiple atomic statements), or `close` (end the server-side session).

**2. Typed argument encoding.** D1's `?` placeholders are bound to a
JS array — `{sql: "...", params: ["hello", 42, null]}`. libSQL's are
typed objects on the wire:

```json
{
  "sql": "INSERT INTO laika_storage (Path, Type) VALUES (?, ?)",
  "args": [
    {"type": "text",    "value": "notes/hello.md"},
    {"type": "text",    "value": "file"}
  ]
}
```

…with `{type: "null"}`, `{type: "integer", value: "42"}` (string,
because JS loses precision past 2^53), `{type: "float", value: 3.14}`,
and `{type: "blob", base64: "..."}` for the other primitive types.
The `bind()` helper handles the JS → wire conversion.

These two combine into the distinguishing property: `removeAtoms(N)`
ships as **one** atomic `batch` request with N conditional `DELETE`
steps. Each step's `condition` is `{type: 'ok', step: prev}` — meaning
"only run if the prior step succeeded" — so the whole batch rolls back
if any step fails. **The 8th structurally distinct atomic-multi-write
mechanism in the Laika suite.**

## Usage

```ts
import {
  LibSqlDataSource,
  LibSqlStorageRepository,
} from '@laikacms/libsql/storage-libsql';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const dataSource = new LibSqlDataSource({
  url: 'https://example-org.turso.io',
  auth: { token: process.env.TURSO_TOKEN! },
});

const repo = new LibSqlStorageRepository({
  dataSource,
  tableName: 'laika_storage',
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## Schema

```sql
CREATE TABLE laika_storage (
  Path      TEXT PRIMARY KEY,
  Parent    TEXT NOT NULL,
  Name      TEXT NOT NULL,
  Type      TEXT NOT NULL CHECK (Type IN ('file', 'folder')),
  Extension TEXT,
  Content   TEXT,
  UNIQUE (Type, Parent, Name)
);
CREATE INDEX laika_storage_parent_idx ON laika_storage (Parent);
```

The `(Type, Parent, Name)` UNIQUE makes extension-free key resolution
(`WHERE Type = ? AND Parent = ? AND Name = ?`) an index lookup.

## Operation mapping

| Laika operation             | libSQL call(s)                                            |
|-----------------------------|-----------------------------------------------------------|
| `getObject(key)`            | 1 × `execute` SELECT                                      |
| `createObject(key, …)`      | 1 × `execute` SELECT (probe) + 1 × `execute` INSERT       |
| `updateObject(key, …)`      | 1 × `execute` SELECT (read row) + 1 × `execute` UPDATE    |
| `createOrUpdateObject`      | 1 × `execute` SELECT + 1 × `execute` `INSERT … ON CONFLICT DO UPDATE` |
| `createFolder(key)`         | 1 × `execute` `INSERT … ON CONFLICT DO NOTHING`           |
| `removeAtoms([k₁…kₙ])`      | n × `execute` SELECT (resolve) + **1 × `batch` with N conditional DELETE steps** |
| `listAtomSummaries(folder)` | 1 × `execute` SELECT WHERE Parent = ?                     |
| `getCapabilities()`         | (no I/O — static)                                         |

## Auth

```ts
new LibSqlDataSource({
  url: BASE,
  auth: {
    token: process.env.TURSO_TOKEN,
    // …or:
    tokenProvider: async () => fetchTokenFromVault(),
  },
});
```

For self-hosted `sqld` without auth, omit the `auth` block. Otherwise
the token is passed as `Authorization: Bearer <token>`.

## Caveats

- **No embedded replica support.** This package speaks the pure HTTP
  pipeline protocol. If you want libSQL's local embedded-replica
  feature (where the client maintains a local SQLite that
  asynchronously syncs against the upstream), use `@libsql/client`
  directly — the repository's structural dependency on
  `MongoCollectionLike`-style would let you adapt it, but that's
  beyond v1.
- **`bigint`s are returned as strings.** libSQL serialises integers
  as string values to preserve precision past 2^53. The repository
  doesn't try to coerce — anything in the `Content` column round-trips
  as text, but app code reading numeric columns directly needs to
  parse explicitly.
- **No HRANA over WebSocket.** libSQL also exposes a WebSocket
  protocol (`hrana3`) with bidirectional streaming and session
  resumption via `baton`. This package uses the HTTP variant only.
