# @laikacms/bitbucket

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

- Initial release. Bitbucket-backed `StorageRepository` via the Cloud REST v2 API. App-password or
  OAuth2 auth. Closes the git-platform triumvirate alongside `@laikacms/github` and
  `@laikacms/gitlab`. All writes (creates, updates, deletes) go through Bitbucket's unified
  `POST /src` multipart commit endpoint. Runtime-agnostic — only depends on `fetch`.
