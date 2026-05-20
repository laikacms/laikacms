---
"@laikacms/google": minor
---

New package: `@laikacms/google`. First export `@laikacms/google/storage-drive`
— a Google Drive-backed `StorageRepository` via the Drive REST v3 API.
Static-token or async `tokenProvider` auth (caller owns OAuth2), real Drive
folders rather than `.keep` placeholders, multipart upload on create,
media-only `PATCH` on update, instance-local path → id cache. Runtime-agnostic
— only depends on `fetch`. The package mirrors the `@laikacms/aws` shape: each
subpath is independent so consumers only pay for what they use.
