# @laikacms/gitlab

## 1.0.0

### Minor Changes

- Initial release. GitLab-backed `StorageRepository` via the REST v4 API.
  PAT / OAuth / CI-job-token auth, optimistic concurrency via `last_commit_id`,
  upsert via `POST` → `PUT` fallback, parallel pagination. Runtime-agnostic:
  only depends on `fetch`.
