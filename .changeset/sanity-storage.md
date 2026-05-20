---
"@laikacms/sanity": minor
---

New package: `@laikacms/sanity`. First export
`@laikacms/sanity/storage-sanity` — a `StorageRepository` backed by Sanity
via the Content Lake HTTP API. GROQ for reads, **transactional `/mutate`**
for writes — deep keys + ancestor folder markers commit atomically in one
HTTP request, in contrast to every other backend in the suite which writes
folder markers separately. Native optimistic concurrency via Sanity's
`_rev`, surfaced as `metadata.revisionId` and round-tripped on
`updateObject` as `ifRevisionID`. Documents are addressed by SHA-256 hash
of the storage path (Sanity forbids `/` in `_id`); override `idFor` for a
custom encoding. Runtime-agnostic — only depends on `fetch` and Web Crypto.
