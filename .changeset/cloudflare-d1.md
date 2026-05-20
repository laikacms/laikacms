---
"@laikacms/cloudflare": minor
---

New package: `@laikacms/cloudflare`. First export
`@laikacms/cloudflare/storage-d1` — a `StorageRepository` backed by
Cloudflare D1 (managed SQLite) over its HTTP REST API. SQL at the edge,
runs everywhere `fetch` runs. Caller provisions the schema via the exported
`schemaDdl()` helper (the repository never runs DDL itself). Single-`LIKE`
extension probe resolves extension-free keys in one indexed query regardless
of how many serializers are registered — different shape from every other
DB-backed backend in the suite, which either fan out parallel `EXISTS`
calls or pre-index on a synthetic attribute.
