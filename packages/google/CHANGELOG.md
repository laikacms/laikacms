# @laikacms/google

## 1.0.0

### Minor Changes

- Initial release. Google Drive-backed `StorageRepository` via the Drive
  REST v3 API. Static-token or `tokenProvider` auth, real Drive folders
  (no `.keep` placeholders), multipart upload for create, media-only
  PATCH for update, instance-local path → id cache. Runtime-agnostic:
  only depends on `fetch`.
