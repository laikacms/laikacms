# @laikacms/decap

## 3.0.1

### Patch Changes

- Bump the `@laikacms/decap-cms` peer dependency to `4.1.0` (and the dev dependency used for
  type-checking/tests to match). The supported minimum is now `>=4.1.0`.
  - laikacms@3.0.1

## 3.0.0

### Major Changes

- 3b56c53: **Breaking:** `decap-api` now cleanly separates authentication from authorization.

  - Authentication (`authenticateAccessToken` / `authenticateApiToken`) returns the principal's
    **identity** only. The `scope` field has been **removed** from the `User` interface.
  - Authorization is now a single **required** `authorize(ctx)` callback on `DecapOptions`. It
    receives an `AuthorizeContext` —
    `{ user, request, method, domain, operation, collection?, itemId? }` — the principal plus the
    request pre-parsed into resource/operation so a policy can decide without re-parsing the URL.
    Return `true` to allow, `false` to reject with `403 Forbidden` before the request reaches any
    repository; a thrown callback fails closed. There is no implicit default — the policy must be
    stated.

  Migration:

  ```ts
  // Before — scope was carried on the User and enforced implicitly:
  authenticateAccessToken: async t => ({ id, email, scope: readOnly ? 'read' : 'write' }),

  // After — identity from authenticate*, policy in authorize:
  authenticateAccessToken: async t => ({ id, email }),
  authorize: ctx => (readOnly ? ctx.operation === 'read' : true),
  ```

  Richer authorization ("roles", "admin", per-org rules) is expressed by augmenting the `User`
  interface with your own identity fields and checking them inside `authorize` — the API no longer
  imposes a fixed read/write vocabulary.

### Minor Changes

- e4c987a: Add `@laikacms/decap/decap-cms-backend-laika` subpath export shipping
  `createLaikaBackend()` (PR #820, LCMS-507).

### Patch Changes

- Updated dependencies [68c658f]
- Updated dependencies [d26bdfe]
  - laikacms@3.0.0

## 2.2.0

### Minor Changes

- 6578534: Enforce read-only scope at the API boundary. `User` now carries an optional
  `scope: 'read' | 'write'`; when it is explicitly `'read'`, `decapApi` rejects any mutating (non
  GET/HEAD/OPTIONS) request with a 403 before it reaches a sub-API, so a read-only credential can no
  longer write even though the repositories grant every authenticated principal full read+write.
  Backwards compatible: principals with `scope` unset or `'write'` keep full access.

### Patch Changes

- laikacms@2.2.0

## 2.1.1

### Patch Changes

- cc4d315: Remove the unused direct `zod` dependency from the server-only Decap integration package.

  The Decap API and OAuth2 documentation now also covers the `authenticateRequest` method and
  additional top-level OAuth configuration options.

  The published package now includes an MIT `LICENSE` file.

- Updated dependencies [cc4d315]
  - laikacms@2.1.1

## 2.1.0

### Patch Changes

- Updated dependencies
  - laikacms@2.1.0

## 2.0.0

### Major Changes

- Remove all client-side Decap code; the package now only ships the server-side `decap-api` and
  `decap-oauth2` modules.

  Removed exports: `decap-cms-widget-lucide-icon`, `decap-cms-widget-radix-icon`,
  `decap-cms-locale-nl`, `decap-config-types`, and `decap-cms-editor-component-embedded-entry`. The
  `@laikacms/decap-ai` package has been removed from the workspace entirely and will no longer
  receive releases.

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - laikacms@2.0.0

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
