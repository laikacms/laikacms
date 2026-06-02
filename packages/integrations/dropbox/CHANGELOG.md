# @laikacms/dropbox

## 1.0.1

### Patch Changes

- Updated dependencies [e488528]
  - laikacms@1.0.1

## 1.0.0

### Minor Changes

- Initial release. Dropbox-backed `StorageRepository` via the HTTP API v2. Static-token or async
  `tokenProvider` auth, optimistic concurrency via Dropbox `rev` (exposed as `metadata.revisionId`),
  real Dropbox folders (no `.keep` placeholders), idempotent ancestor-folder creation for deep keys.
  Runtime-agnostic — only depends on `fetch`.
