---
"@laikacms/bitbucket": minor
---

New package: `@laikacms/bitbucket`. First export
`@laikacms/bitbucket/storage-bb` — a `StorageRepository` backed by Bitbucket
Cloud via the REST v2 API. App-password or OAuth2 auth (both schemes verified
end-to-end). Closes the git-platform triumvirate alongside `@laikacms/github`
and `@laikacms/gitlab`. All writes (creates, updates, deletes) go through
Bitbucket's unified `POST /src` multipart commit endpoint — so the underlying
data source exposes a `commit({puts, deletes})` call for atomic multi-file
commits, even though the storage-contract surface is one-file-at-a-time for
parity. Runtime-agnostic — only depends on `fetch`.
