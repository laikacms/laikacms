---
"@laikacms/algolia": minor
---

New package: `@laikacms/algolia`. First export
`@laikacms/algolia/storage-algolia` — a `StorageRepository` backed by an
Algolia search index. Each record carries reserved `_type`, `_parent`,
`_extension`, `_content` attributes so listing a folder becomes one filtered
query (`filters=_parent:"<folder>"`) rather than a prefix scan. Useful when
you want full-text search over your content "for free" — every record this
repository writes is immediately indexed by Algolia. Runtime-agnostic —
only depends on `fetch`.
