---
"@laikacms/hygraph": minor
---

New package: `@laikacms/hygraph`. First export `@laikacms/hygraph/storage-hygraph` — a
`StorageRepository` backed by [Hygraph](https://hygraph.com) (formerly GraphCMS) via the GraphQL
Content API. **The first true-GraphQL transport in the suite** — Sanity uses GROQ, not standard
GraphQL. Assumes `LaikaObject` and `LaikaFolder` content models exist on the project (provision via
Hygraph Studio). Lists both files and folders in **one** GraphQL operation by asking for two
top-level fields in the same request. Runtime-agnostic — only depends on `fetch`.
