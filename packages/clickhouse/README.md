# @laikacms/clickhouse

[ClickHouse](https://clickhouse.com/)-backed implementations of Laika
CMS contracts. First (and current) export:
**`@laikacms/clickhouse/storage-clickhouse`** — a `StorageRepository`
over the ClickHouse HTTP interface.

Runtime-agnostic — only depends on `fetch`. Works against self-hosted
ClickHouse, ClickHouse Cloud, and Cloudflare's ClickHouse-compatible
Workers Analytics Engine (with minor schema tweaks).

```bash
pnpm add @laikacms/clickhouse
```

## Why a ClickHouse package

ClickHouse is a columnar OLAP database designed for high-throughput
reads against append-mostly tables. Four traits set the wire shape
apart from every prior backend in the Laika suite:

**1. Streaming NDJSON wire format.** ClickHouse's `FORMAT JSONEachRow`
returns newline-delimited JSON — one row per line, parseable
incrementally. INSERTs accept the same format in the request body:

```http
POST /?query=INSERT INTO laika_storage FORMAT JSONEachRow

{"path":"notes/a.md","content":"…"}
{"path":"notes/b.md","content":"…"}
{"path":"notes/c.md","content":"…"}
```

**First backend in the suite with streaming row-at-a-time wire
format.** The `parseNdjson` / `serializeNdjson` helpers handle the
boundary — exported for app code that wants direct access.

**2. URL-as-query.** SQL travels in the request URL as
`?query=<urlencoded SQL>`, NOT the body. The body is reserved for
INSERT data. The "split" is structural — the same HTTP request can
carry both a SQL query in the URL and inline NDJSON data in the body.
**First backend in the suite where SQL and payload occupy different
parts of the wire envelope.**

**3. `ReplacingMergeTree(version)` upsert semantics.** Schemas using
this engine deduplicate rows on background merges, keeping the row
with the highest version per ORDER BY key. Writes are effectively
idempotent upserts — re-inserting the same path with a newer version
takes precedence on read with `FINAL`.

**4. `FINAL` read modifier.** The `FINAL` keyword forces a merge-on-read,
returning the latest version per ORDER BY key. **First backend in the
suite using explicit consistency-vs-performance read modifiers** —
every read in the repository uses `FINAL` for ReplacingMergeTree
consistency. Costs some read performance, gains correctness.

## Usage

```ts
import {
  ClickHouseDataSource,
  ClickHouseStorageRepository,
} from '@laikacms/clickhouse/storage-clickhouse';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const dataSource = new ClickHouseDataSource({
  url: 'https://clickhouse.example.com:8443',
  database: 'cms',
  auth: { headers: { username: 'cms_user', password: process.env.CLICKHOUSE_PASSWORD! } },
});

const repo = new ClickHouseStorageRepository({
  dataSource,
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## Schema setup

The repository runs no DDL. Provision once via `clickhouse-client` or
the UI:

```sql
CREATE TABLE laika_storage (
  path       String,
  parent     String,
  name       String,
  type       LowCardinality(String),
  extension  String DEFAULT '',
  content    String DEFAULT '',
  version    UInt64 DEFAULT toUnixTimestamp64Milli(now64()),
  createdAt  String DEFAULT toString(now64()),
  updatedAt  String DEFAULT toString(now64())
) ENGINE = ReplacingMergeTree(version)
PRIMARY KEY (type, parent, name)
ORDER BY (type, parent, name);
```

The `version` column passed to `ReplacingMergeTree` is the dedup tie-breaker:
when two rows share the same ORDER BY key, the row with the higher
version wins. The repository sets `version = Date.now()` on every
write — Unix-millis monotonic-per-process.

## Operation mapping

| Laika operation             | ClickHouse                                                                  |
|-----------------------------|-----------------------------------------------------------------------------|
| `getObject(key)`            | `SELECT … FROM table FINAL WHERE type='file' AND parent={parent:String} AND name={name:String} LIMIT 1` |
| `createObject(key, …)`      | 1 × probe SELECT + 1 × `INSERT INTO table FORMAT JSONEachRow` + body NDJSON |
| `updateObject(key, …)`      | 1 × probe + 1 × INSERT new row with newer version (ReplacingMergeTree dedups on merge) |
| `createOrUpdateObject`      | 1 × probe + 1 × INSERT (always; ReplacingMergeTree handles dedup)           |
| `createFolder(key)`         | 1 × INSERT (idempotent — re-inserts dedup on next merge)                    |
| `removeAtoms([k₁…kₙ])`      | n × probe + **1 × `DELETE FROM table WHERE type='file' AND path IN (?, ?, …) SETTINGS mutations_sync=1`** |
| `listAtomSummaries(folder)` | 1 × `SELECT … FROM table FINAL WHERE parent={parent:String}`                |
| `getCapabilities()`         | (no I/O — static)                                                           |

## What this iteration does NOT add

`removeAtoms(N)` ships as a single `DELETE FROM … WHERE path IN (…)`
statement — the same shape as Supabase PostgREST (iter 24). **This is
NOT a new atomic-multi-write mechanism.** Honest framing: the novelty
in this backend is in the wire format and engine semantics, not in
multi-write atomicity.

ClickHouse's lightweight deletes (`DELETE FROM …`) were historically
mutations (asynchronous, eventually atomic); with `SETTINGS
mutations_sync = 1` they're synchronous at the statement level. The
repository always sets this so users get predictable semantics.

## Auth

Two equivalent auth shapes:

```ts
// HTTP Basic
new ClickHouseDataSource({
  url, database,
  auth: { basic: { username: 'admin', password: 'pw' } },
});

// X-ClickHouse-User / X-ClickHouse-Key headers (production-preferred)
new ClickHouseDataSource({
  url, database,
  auth: { headers: { username: 'admin', password: 'pw' } },
});
```

For ClickHouse Cloud, use the `headers` variant — Cloudfront in front
of CH Cloud doesn't always forward `Authorization` cleanly.

## Caveats

- **Table identifiers are interpolated, not parameterised.** ClickHouse
  doesn't have `{table:Identifier}` parameter syntax — table names go
  straight into SQL. The repository validates the configured table
  name against `^[A-Za-z_][A-Za-z0-9_]*$`.
- **`FINAL` costs read performance.** Each read with `FINAL` does an
  on-the-fly merge. For high-traffic reads, consider a materialized
  view that pre-merges the data.
- **Lightweight deletes leave tombstones until the next background
  merge.** With `mutations_sync=1` the delete is visible on subsequent
  reads, but storage isn't reclaimed until merge. The `SETTINGS`
  clause is the right knob for CMS workloads (low-frequency deletes);
  for high-volume deletes, drop the partition instead.
- **No native streaming response from the repository.** The data source
  returns `T[]` for reads — it buffers the full NDJSON response before
  parsing. For very large list queries, layer a custom streaming
  parser at the data-source layer.
