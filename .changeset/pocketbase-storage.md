---
"@laikacms/pocketbase": minor
---

New package: `@laikacms/pocketbase`. First export `@laikacms/pocketbase/storage-pb` — a
`StorageRepository` backed by PocketBase, the single-binary self-hostable backend-as-a-service. The
first **self-hostable open-source** backend in the suite — every other backend so far has been a
SaaS endpoint, a hyperscaler service, or a network protocol. SQLite under the hood, REST + JWT on
the wire, PocketBase's own filter mini-language (`&&`, `||`, parens, quoted literals) for queries.
Records live in a configurable collection (default `laika_storage`); the repository expects the
collection to be provisioned ahead of time via `pb migrate` or the admin UI. Runtime-agnostic — only
depends on `fetch`.
