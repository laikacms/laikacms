---
"@laikacms/dropbox": minor
---

New package: `@laikacms/dropbox`. First export
`@laikacms/dropbox/storage-dropbox` — a `StorageRepository` backed by Dropbox
via the HTTP API v2. Path-addressed (no id walk), real Dropbox folders, first-
class optimistic concurrency via Dropbox `rev` exposed as
`metadata.revisionId`. Static `accessToken` or async `tokenProvider` auth.
Runtime-agnostic — only depends on `fetch`.
