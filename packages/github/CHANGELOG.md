# @laikacms/github

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

### Major Changes

- Integrated with effect channels and changed the interfaces

  This is a breaking change because it includes changes to the interfaces of the repositories.

### Patch Changes

- Updated dependencies
  - laikacms@1.0.0

## 0.1.2

### Patch Changes

- Updated dependencies
  - laikacms@0.1.2
