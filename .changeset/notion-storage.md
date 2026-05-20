---
"@laikacms/notion": minor
---

New package: `@laikacms/notion`. First export
`@laikacms/notion/storage-notion` — a `StorageRepository` backed by Notion.
Page hierarchy maps to storage hierarchy: pages-with-children become
folders, leaf pages become objects, paragraph-block content becomes the
object body. Instance-local path → page-id cache, static-token or async
`tokenProvider` auth. Runtime-agnostic — only depends on `fetch`.
