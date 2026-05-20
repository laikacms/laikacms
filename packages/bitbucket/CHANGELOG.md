# @laikacms/bitbucket

## 1.0.0

### Minor Changes

- Initial release. Bitbucket-backed `StorageRepository` via the Cloud
  REST v2 API. App-password or OAuth2 auth. Closes the git-platform
  triumvirate alongside `@laikacms/github` and `@laikacms/gitlab`. All
  writes (creates, updates, deletes) go through Bitbucket's unified
  `POST /src` multipart commit endpoint. Runtime-agnostic — only depends
  on `fetch`.
