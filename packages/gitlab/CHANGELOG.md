# @laikacms/gitlab

## 1.0.4

### Patch Changes

- Updated dependencies [2f17498]
- Updated dependencies [2f17498]
- Updated dependencies [2f17498]
  - laikacms@5.0.0

## 1.0.3

### Patch Changes

- Updated dependencies
- Updated dependencies
  - laikacms@3.1.0

## 1.0.2

### Patch Changes

- laikacms@3.0.1

## 1.0.1

### Patch Changes

- 7cc69ce: Advertise `changes: unsupportedChanges` in `getCapabilities()` to satisfy the
  now-required `changes` capability on the storage `Capabilities` interface. These git-backed
  repositories do not expose a push change channel, so they report the no-op channel;
  `subscribeChanges` remains unsupported.
- Updated dependencies [68c658f]
- Updated dependencies [d26bdfe]
  - laikacms@3.0.0

## 1.0.1

### Patch Changes

- Updated dependencies [e488528]
  - laikacms@1.0.1

## 1.0.0

### Minor Changes

- Initial release. GitLab-backed `StorageRepository` via the REST v4 API. PAT / OAuth / CI-job-token
  auth, optimistic concurrency via `last_commit_id`, upsert via `POST` → `PUT` fallback, parallel
  pagination. Runtime-agnostic: only depends on `fetch`.
