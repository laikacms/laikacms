# @laikacms/influxdb

[InfluxDB v2](https://www.influxdata.com/)-backed implementations of Laika CMS contracts. First (and
current) export: **`@laikacms/influxdb/storage-influxdb`** — a `StorageRepository` over the InfluxDB
v2 HTTP API.

Runtime-agnostic — only depends on `fetch`.

```bash
pnpm add @laikacms/influxdb
```

## Why an InfluxDB package — and why it's unusual

InfluxDB is a **time-series database**. Storing CMS content in a time-series store is _unusual_ —
every write creates a new point at the current timestamp; reads use `|> last()` to dedupe across the
series. This works for small-to-medium CMS workloads where the append model is acceptable; for
high-write-frequency or strict-storage-budget workloads, a different backend fits better.

The package exists because InfluxDB's wire-format choices are **genuinely distinct** from every
prior backend in the Laika suite:

**1. Line protocol writes.** Newline-delimited textual writes:

```
laika_storage,kind=file,parent=notes,name=hello,extension=md,path=notes/hello.md content="hi" 1700000000000000000
```

Tags are URL-style (key=value, comma-separated), fields are SQL-string-style (string values quoted),
the trailing token is a nanosecond timestamp. **First textual line-by-line write format in the
suite.**

**2. Flux pipeline DSL for reads.** Functional `|>`-piped expressions:

```flux
from(bucket: "cms")
  |> range(start: 0)
  |> filter(fn: (r) => r._measurement == "laika_storage" and r.kind == "file" and r.name == "hello")
  |> last()
  |> pivot(rowKey: ["_time", "kind", "parent", "name", "extension", "path"], columnKey: ["_field"], valueColumn: "_value")
```

**First functional pipeline DSL in the suite** — Cypher uses pattern matching, SurrealDB / EdgeQL
use shape literals, Cassandra/D1/libSQL use SQL. Flux is structurally different — closer to LINQ or
`xargs`.

**3. Annotated CSV responses.** Reads come back as CSV with `#datatype`, `#group`, `#default`
annotation rows preceding the column header:

```
#datatype,string,long,dateTime:RFC3339,string,string,string,string,string,string
#group,false,false,false,true,true,true,true,true,false
#default,_result,,,,,,,,,
,result,table,_time,_measurement,kind,parent,name,extension,content
,,0,2026-05-20T10:00:00Z,laika_storage,file,notes,hello,md,hi
```

**First CSV-on-the-wire backend.** The package's `parseAnnotatedCsv` helper handles the annotation
rows + header + data rows.

**4. Tags vs fields distinction.** Tags are indexed strings; fields are arbitrary values. The data
model:

| Column                                        | Type  | Purpose                                      |
| --------------------------------------------- | ----- | -------------------------------------------- |
| `kind`, `parent`, `name`, `extension`, `path` | tag   | indexed; used in filters & delete predicates |
| `content`                                     | field | the bulky string payload                     |

**First indexed/unindexed column distinction in the suite.**

**5. Nanosecond timestamps.** Writes carry full sub-millisecond precision
(`Date.now() * 1_000_000`). Surfaces as `metadata.revisionId` on every read — **first backend where
revisionId is a nanosecond timestamp**.

**6. `Authorization: Token <token>` header.** Literally the word `Token`, not `Bearer`. **Distinct
from every other auth header convention** in the suite.

## Usage

```ts
import { InfluxDbDataSource, InfluxDbStorageRepository } from '@laikacms/influxdb/storage-influxdb';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const dataSource = new InfluxDbDataSource({
  url: 'http://influxdb:8086',
  org: 'my-org',
  bucket: 'cms',
  auth: { token: process.env.INFLUX_TOKEN! },
});

const repo = new InfluxDbStorageRepository({
  dataSource,
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## Bucket setup

```bash
# Create the bucket via influx CLI
influx bucket create -n cms -o my-org -r 0  # 0 = infinite retention
```

The repository assumes infinite retention. For workloads where you _want_ automatic expiry of old
versions, set a retention period — just be aware that the repository's "latest" semantics relies on
the latest point per tag-set still being in the bucket.

## Operation mapping

| Laika operation             | InfluxDB v2 call(s)                                                       |
| --------------------------- | ------------------------------------------------------------------------- |
| `getObject(key)`            | 1 × `POST /api/v2/query` (Flux with `                                     |
| `createObject(key, …)`      | 1 × probe query + 1 × `POST /api/v2/write` (line protocol)                |
| `updateObject(key, …)`      | 1 × probe + 1 × line protocol write (new point)                           |
| `createOrUpdateObject`      | 1 × probe + 1 × line protocol write                                       |
| `createFolder(key)`         | 1 × line protocol write with `kind=folder`                                |
| `removeAtoms([k₁…kₙ])`      | n × probe + **n × parallel `POST /api/v2/delete`** (no bulk-OR predicate) |
| `listAtomSummaries(folder)` | 1 × Flux query with `filter(r.parent == "…")`                             |
| `getCapabilities()`         | (no I/O — static)                                                         |

## What this iteration does NOT add

`removeAtoms(N)` does N parallel `/api/v2/delete` calls — Influx v2's predicate language only
supports `=` equality between AND'd clauses; OR is not reliably supported across versions. **Not a
new atomic-multi-write mechanism** (same honest framing as Solid Pod, ClickHouse, Trello, Convex).

## Caveats

- **Append-only storage.** Every write creates a new point. Reads apply `|> last()` to dedupe. Old
  versions remain until deleted or expired by retention policy. For high-write-frequency workloads
  this isn't ideal — a relational/document backend fits better.
- **No transactional writes.** Influx writes are eventually consistent at the WAL level. Concurrent
  writes to the same tag-set produce two points; the one with the higher timestamp wins on read.
- **Predicate language is restrictive.** Delete predicates only support `=` between AND'd clauses,
  on tag keys (not field keys). We tag `path` precisely so it can appear in the delete predicate.
- **Cardinality limits.** InfluxDB caps tag cardinality at ~1M series per bucket (configurable, but
  with cost). For a CMS where every file is a unique `(parent, name)` tag-set, large file counts
  approach this limit — consider partitioning by tenant via the bucket.
- **Nanosecond timestamps as strings.** JS numbers lose precision past 2^53; the data source
  stringifies nanosecond timestamps.
- **`Authorization: Token`, not `Bearer`.** Pay attention to your reverse proxies / API gateways —
  some normalise to `Bearer` and break this.
