# @laikacms/sanity

## 1.0.0

### Minor Changes

- Initial release. Sanity-backed `StorageRepository` via the Content Lake
  HTTP API. GROQ for reads, **transactional `/mutate`** for writes — deep
  keys + ancestor folder markers commit atomically in one HTTP request.
  Native optimistic concurrency via `_rev` exposed as
  `metadata.revisionId`. Documents addressed by SHA-256 hash of the path
  (Sanity forbids `/` in `_id`); override `idFor` for custom encodings.
  Runtime-agnostic — only depends on `fetch` and Web Crypto.
