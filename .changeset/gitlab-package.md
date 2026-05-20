---
"@laikacms/gitlab": minor
---

New package: `@laikacms/gitlab`. GitLab-backed `StorageRepository` via the
REST v4 API. Authenticates with a Personal Access Token, an OAuth bearer
token, or a CI job token; supports optimistic concurrency via
`last_commit_id`; upserts by trying `POST` first then falling back to `PUT`
on conflict. Parallels `@laikacms/github` and reserves the `/gitlab/...`
gateway URL prefix. Runtime-agnostic — only depends on `fetch`.
