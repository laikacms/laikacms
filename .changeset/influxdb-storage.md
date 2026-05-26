---
"@laikacms/influxdb": minor
---

New package: `@laikacms/influxdb`. First export `@laikacms/influxdb/storage-influxdb` — a
`StorageRepository` backed by [InfluxDB v2](https://www.influxdata.com/) via the HTTP API. **First
time-series backend in the suite**. Six wire-format traits distinguish it from every prior backend:
(1) **line protocol writes** — newline-delimited textual format
`measurement,tag=v field="v" timestamp_ns`. First textual line-by-line write format in the suite;
(2) **Flux pipeline DSL for reads** — functional `|>`-piped expressions
(`from(...) |> filter(...) |> last() |> pivot(...)`). **First functional pipeline DSL in the suite**
— Cypher uses pattern-matching, EdgeQL/SurrealDB use shape literals, SQL-likes use SELECT/INSERT;
(3) **annotated CSV responses** — `#datatype` / `#group` / `#default` header rows precede the
column-name header. First CSV-on-the-wire backend; (4) **tags vs fields distinction** — tags are
indexed strings (used in filters & delete predicates); fields are arbitrary values. First
indexed/unindexed column distinction in the suite; (5) **nanosecond timestamps** —
`Date.now() * 1_000_000` precision in line protocol writes. First backend where `revisionId` is a
sub-millisecond timestamp; (6) **`Authorization: Token <token>`** header (literally the word
`Token`, NOT `Bearer`). Distinct from every other auth header convention. Honest about the
time-series shape being unusual for CMS — append-only storage with `|> last()` dedup semantics works
for small-to-medium workloads. `removeAtoms(N)` does N parallel `/api/v2/delete` calls — Influx v2's
predicate language only supports `=` equality between AND'd clauses; not a new atomic-multi-write
mechanism. Runtime-agnostic — only depends on `fetch`.
