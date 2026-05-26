---
"@laikacms/surrealdb": minor
---

New package: `@laikacms/surrealdb`. First export `@laikacms/surrealdb/storage-surrealdb` — a
`StorageRepository` over a SurrealDB cluster via the HTTP `/sql` endpoint. Four architectural traits
distinguish it from prior SQL-ish backends: (1) **`table:id` record identity** — record IDs are
first-class composite handles, with safe construction via `type::thing("table", $path)`; (2) **NS /
DB header isolation** — namespace and database scoped via `NS:` / `DB:` request headers (first
backend in the suite with header-based tenancy); (3) **`BEGIN TRANSACTION; …; COMMIT TRANSACTION;`
as the atomic primitive** — `removeAtoms(N)` packs N DELETEs into one transaction inside a single
`POST /sql` body. The 12th structurally distinct atomic-multi-write mechanism; (4) **per-statement
result envelopes** — every `POST /sql` returns an array of `{status, time, result}` entries, one per
statement. The data source's `transaction()` helper namespaces variables per-statement to avoid
collision in SurrealDB's global query-string vars. Runtime-agnostic — only depends on `fetch`.
