---
"@laikacms/clickhouse": minor
---

New package: `@laikacms/clickhouse`. First export
`@laikacms/clickhouse/storage-clickhouse` — a `StorageRepository`
backed by [ClickHouse](https://clickhouse.com/) via the HTTP
interface. Works against self-hosted ClickHouse and ClickHouse Cloud.
Four architectural traits distinguish it from prior SQL-ish backends:
(1) **streaming NDJSON wire format** — `FORMAT JSONEachRow` returns
newline-delimited JSON; INSERTs accept the same format in the body.
First backend with streaming row-at-a-time wire format. Exported
`parseNdjson` / `serializeNdjson` helpers handle the boundary;
(2) **URL-as-query** — SQL travels in the URL as `?query=<urlencoded
SQL>`, NOT the body. Body is reserved for INSERT NDJSON data. First
backend where SQL and payload occupy different parts of the wire
envelope;
(3) **`ReplacingMergeTree(version)` upsert semantics** — writes are
INSERTs with monotonic version columns; duplicate rows are deduped
on background merges. No conditional INSERT-or-UPDATE needed at the
application layer;
(4) **`FINAL` read modifier** — every SELECT uses `FINAL` to force
merge-on-read for latest-version visibility. First backend with
explicit consistency-vs-performance read modifiers. Honest about
what's *not* here: `removeAtoms(N)` ships as `DELETE FROM …
WHERE path IN (…)` — the same atomic shape as Supabase PostgREST
(iter 24); not a new atomic-multi-write mechanism. Runtime-agnostic
— only depends on `fetch`.
