# @laikacms/decap

## 1.3.0

### Patch Changes

- Updated dependencies [42363a1]
  - laikacms@1.3.0

## 1.2.0

### Minor Changes

- **BREAKING (alpha): version tracking and change-signal capabilities, required everywhere**

  `laikacms`:

  - Documents and assets repositories can now advertise per-record `version` tokens
    (`versionTracking`) and a change-signal surface (`changes`: `getSyncToken` / `listChanges`).
  - `DocumentsCapabilitiesSchema` and `AssetsCapabilitiesSchema` require the new `versionTracking`
    and `changes` fields — they are no longer optional. Every repository implementation must
    explicitly declare `{ supported: false, description }` instead of omitting the field. The
    documents-api and assets-api `/capabilities` responses now always include both fields.
  - The deprecated `draftDirectory`, `archiveDirectory`, and `trashDirectory` document-collection
    settings have been removed. Use `unpublishedStatuses` instead.

  `@laikacms/decap`:

  - `OAuthTotpCallbacks.deletePendingTotpSession`, `getLastTotpStep`, and `setLastTotpStep` are now
    required. RFC 6238 §5.2 replay protection and single-use pending TOTP sessions are always
    enforced; implementations can no longer opt out by omitting the callbacks.
  - The unused `decap-cms-backend-laika` backend has been removed from the package.

  **Migration:**

  - Custom `DocumentsRepository` / `AssetsRepository` implementations: add explicit
    `versionTracking` and `changes` entries to `getCapabilities()` —
    `{ supported: false,
description: '...' }` if unsupported.
  - TOTP integrations: implement the three callbacks; a minimal store keyed by user id suffices.
  - Replace any `draftDirectory`/`archiveDirectory`/`trashDirectory` settings with
    `unpublishedStatuses`.

### Patch Changes

- Updated dependencies [827ffe2]
- Updated dependencies
  - laikacms@1.2.0

## 1.1.0

### Patch Changes

- Updated dependencies [96f8692]
- Updated dependencies [96f8692]
  - laikacms@1.1.0

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

- Moved to hybrid monorepo structure
- Updated dependencies
  - laikacms@0.1.2
