---
"@laikacms/libsql": minor
---

New package: `@laikacms/libsql`. First export `@laikacms/libsql/storage-libsql` — a
`StorageRepository` backed by libSQL via the hrana HTTP pipeline protocol. Works against Turso
Cloud, self-hosted `sqld`, and Fly libSQL. Distinct from Cloudflare D1 (also SQLite-on-HTTP) in two
structural ways: (1) the wire shape is `POST /v2/pipeline` carrying N requests per HTTP round-trip,
vs D1's one-statement `/query`; (2) arguments are typed objects on the wire
(`{type: "text", value: "..."}`, `{type: "null"}`, `{type: "integer",
value: "42"}`), vs D1's bare
positional `?` params. The combination yields a new atomic-multi-write mechanism: `removeAtoms(N)`
ships as one `batch` request with N conditional `DELETE` steps, each
`condition: {type: 'ok', step: prev}` chaining to the previous — the whole batch rolls back if any
step fails. 8th structurally distinct atomic-multi-write in the Laika suite. Runtime-agnostic — only
depends on `fetch`.
