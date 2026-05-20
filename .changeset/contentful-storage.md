---
"@laikacms/contentful": minor
---

New package: `@laikacms/contentful`. First export
`@laikacms/contentful/storage-contentful` — a `StorageRepository` backed by
Contentful via the Content Management API. Two-level mapping
(`<contentTypeId>/<entryId>`), no extension hiding, no serializer step
(Contentful stores structured field values). Native optimistic concurrency
via `sys.version` exposed as `metadata.revisionId` and round-tripped on
update. `createFolder` idempotently creates and activates content types.
Runtime-agnostic — only depends on `fetch`.
