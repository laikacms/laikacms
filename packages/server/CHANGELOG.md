# @laikacms/server

## 6.0.0

### Major Changes

- e8ab49b: Require an explicit `authorize` policy on every JSON:API handler, and authorize the
  OpenAPI routes.

  `authorize` was optional on `buildJsonApi` (storage, documents, catalog) and `buildAssetsApi`, and
  omitting it meant "allow every caller everything". A security-critical default that you get by
  _not_ typing something is the wrong shape: the handler that reads, mutates, and deletes all your
  content was one forgotten option away from being wide open, and nothing in the type system said
  so. `@laikacms/server`'s `laikaApi` already required its policy — the four raw handlers were the
  inconsistency.

  `authorize` is now a **required** option on all four:

  ```typescript
  const api = buildJsonApi({
    repo,
    authorize: async ({ action, request }) => {
      const user = await myAuth(request);
      if (!user) return new AuthenticationError('Missing token'); // → 401
      return user.isAdmin || action === 'readOpenApi'; // false → 403
    },
  });
  ```

  For a surface that is deliberately open — a dev server on loopback, a test harness, or a handler
  already behind an authenticating proxy — state that explicitly with the new `allowAll` export from
  `laikacms/json-api`:

  ```typescript
  import { allowAll } from 'laikacms/json-api';

  const api = buildJsonApi({ repo, authorize: allowAll });
  ```

  Naming it rather than inlining `() => true` means every intentionally-open surface in a deployment
  is one `rg 'authorize: allowAll'` away during an audit.

  `GET /openapi.json` and `GET /openapi.yaml` are now authorized like every other action, via a new
  `{ action: 'readOpenApi', format: 'json' | 'yaml' }` variant on each API's action union.
  Previously they were served unconditionally, so a deny-all policy still handed out the full schema
  shape. A policy that wants a public spec alongside a private API allows that one action:

  ```typescript
  authorize: ({ action }) => action === 'readOpenApi' ? true : checkToken(...)
  ```

  `AuthorizeDecision` and `resolveAuthorization` moved to `laikacms/json-api` and are now publicly
  exported — `AuthorizeDecision` appears in the signature of every `*Authorize` callback type but
  was previously unnameable by consumers.

  `@laikacms/vite-plugin`'s local dev API and `@laikacms/server`'s inner handlers pass `allowAll`
  (the vite dev server is loopback-guarded; `laikaApi` authenticates and applies its own `authorize`
  gate before dispatching), so neither changes behaviour.

### Minor Changes

- e8ab49b: Support Node 22. The oauth2 safety gate no longer uses the Node version as a stand-in for
  feature detection, and `engines` drops from `>=24.0.0` to `>=22.0.0` on both packages.

  `LCMS_OAUTH2_NODE_UNSUPPORTED` fired below Node 24 on the stated grounds that such releases "lack
  the global Web Crypto API and no longer receive upstream security fixes". Neither holds for Node
  22: global Web Crypto has been present since Node 19, and Node 22 is in LTS maintenance until
  2027-04-30. Nothing in the package required Node 24 either — `oauth2` imports no `node:*` builtins
  at all (it is bundled for Workers, Deno and Bun), the whole tree compiles to `ES2022`, and the
  heaviest runtime dependency, `@effect/platform-node`, asks only for `>=18`. The floor was the
  repo's own dev-tooling pin propagated into a published constraint, and it refused a runtime that
  could in fact uphold every guarantee the package makes.

  Capability is now decided only by the probes that already existed and test the real thing:
  `LCMS_OAUTH2_CSPRNG_MISSING`, `LCMS_OAUTH2_WEBCRYPTO_SUBTLE_MISSING`,
  `LCMS_OAUTH2_CSPRNG_DEGENERATE`, `LCMS_OAUTH2_SHA256_UNAVAILABLE`, `LCMS_OAUTH2_HMAC_UNAVAILABLE`
  and `LCMS_OAUTH2_PASSKEY_ES256_UNAVAILABLE`. These catch a shimmed or crippled runtime whatever
  version it reports, and clear a capable one a version comparison would have rejected.

  `LCMS_OAUTH2_NODE_UNSUPPORTED` is kept — reason codes are permanent — but now means only what a
  capability probe cannot determine: **the runtime is past end-of-life and receives no security
  patches.** The floor is 22 because Node 21 (EOL 2024-06-01) and Node 20 (EOL 2026-04-30) no longer
  get security fixes, and no probe can detect that from inside the process. It stays `ignorable`.
  Raise the floor when the floor line reaches EOL, not when a new LTS ships.

  Consumers pinned to Node 24 are unaffected. The full `@laikacms/server` (502) and `laikacms`
  (2014) suites pass on Node 22.

### Patch Changes

- 14df4cf: Fix `npx laikacli` crashing with `ERR_MODULE_NOT_FOUND` on
  `effect/unstable/http/Multipasta/Node`.

  The catalog pinned `effect` and `@effect/platform-node` to `4.0.0-beta.66` while
  `@effect/platform-node-shared` sat at `4.0.0-beta.104`. Under npm's hoisting,
  `@effect/platform-node@beta.66`'s own `^4.0.0-beta.66` range on `platform-node-shared` resolved to
  a newer beta whose `effect` peer pulled a newer `effect` to the tree root — so
  `platform-node@beta.66` resolved a module path that no longer exists. pnpm's isolated
  `node_modules` masked this locally, so only npm/npx consumers hit it.

  The whole effect stack is now aligned on `4.0.0-beta.104`. What matters is that all three packages
  are pinned to the _same_ version: npm then dedupes `platform-node`'s transitive caret onto the
  root pin, so the tree stays consistent even after newer betas ship.

  Also fixes two problems surfaced by the bump:

  - `@laikacms/server` imported `effect/DateTime` and `effect/Result` without declaring `effect` as
    a dependency, resolving through a stale phantom symlink. It is now a declared dependency, which
    also makes the published package installable on npm.
  - `effect/Schema`'s `decodeUnknownSync` now throws a real `SchemaError` rather than a plain
    `Error` carrying an `Issue` as its `cause`, so the documents-api error mapper detects it with
    `Schema.isSchemaError`. Without this, internal decode failures regressed from `400 invalid_data`
    to `500 internal_error`.

- Updated dependencies [e8ab49b]
- Updated dependencies [14df4cf]
- Updated dependencies [387a1b4]
- Updated dependencies [06b4a5a]
- Updated dependencies [e8ab49b]
- Updated dependencies [14df4cf]
- Updated dependencies [e8ab49b]
- Updated dependencies [6b918c6]
  - laikacms@6.0.0

### Minor Changes

- 524a8b5: Add `@laikacms/server/ai` subpath — chat + session endpoints for AI-assisted editing via
  `decapAi(config)`. Exports `./ai`, `./ai/providers`, `./ai/tools`, `./ai/i18n/en`, `./ai/i18n/nl`,
  `./ai/i18n/types`.

## 5.0.0

### Major Changes

- 2f17498: Add server-arbitrated advisory document locking (ADR-007, advisory half).

  Two editors opening the same entry now see the same "being edited by X" signal, arbitrated by the
  backend. Previously the only implementation was a browser-local `EntryLockManager` that shared
  locks between tabs of one browser, plus a `LockStore` KV in the server package whose
  read-check-write acquire could let two callers both win.

  **`laikacms`**

  - `Lock`, `LockToken` (an opaque bearer capability), `LockOwner`, `OwnedLock`,
    `DEFAULT_LOCK_TTL_MS` and `LocksCapabilitySchema` from `laikacms/storage`.
  - `LockConflictError` (code `lock_conflict`, **423 Locked**) from `laikacms/core`. 423 rather than
    409 so a client distinguishes "someone else holds this" from `VersionMismatchError`'s "the
    record moved under you" on status alone.
  - `DocumentsCapabilities.locks`, **optional**: a repository that does not lock omits it entirely
    and needs no changes. When present it carries `scope: 'in-process' | 'shared'` and
    `transactional` rather than a bare boolean, so an in-process implementation cannot claim
    cross-node guarantees it does not have.
  - Five capability-gated methods on `DocumentsRepository` (`acquireLock`, `refreshLock`,
    `releaseLock`, `getLock`, `withDocumentLock`), each defaulting to `NotImplementedError`, so
    existing subclasses stay source-compatible.
  - `InProcessLockManager` at the new `laikacms/locks/in-process` subpath: an Effect-transaction
    (`TxHashMap`) implementation whose acquire is genuinely atomic within a node. Reports
    `scope: 'in-process'`, `transactional: false`.
  - `documents-api` gains `GET/POST/DELETE /locks/{key}` and `POST /locks/{key}/refresh`. A conflict
    returns 423 with the current holder in `meta.lock`.
  - `documents-jsonapi-proxy` forwards all four over HTTP; 501 re-hydrates as `NotImplementedError`,
    so a caller sees one behaviour whether the gap is local or remote.

  **`@laikacms/server`** (breaking)

  `LaikaApiOptions.locks` and `LaikaApiOptions.locksTtlMs` are **removed**, along with `LockStore`,
  `createInMemoryLockStore` and `DEFAULT_ENTRY_LOCK_TTL_MS`. `/locks` is now a thin adapter over the
  documents repository and needs no wiring: it is mounted always, and answers 501 when the
  repository does not support locking.

  ```ts
  // Before
  laikaApi({ documents, storage, locks: createInMemoryLockStore(), locksTtlMs: 300_000, ... })

  // After: locking follows the repository's capability
  laikaApi({ documents, storage, ... })
  ```

  To keep single-node locking, delegate the five methods on your documents repository to an
  `InProcessLockManager` and report `InProcessLockManager.capability`.

  The API boundary still derives the lock owner from the authenticated principal and never from the
  request body. Below it, the repository authorises on the token alone and needs no notion of
  identity.

  **Deferred:** the write-precondition ladder (`ifVersion` / `ifLockHeldBy`, enforcement-on-write).
  Locks inform; nothing blocks a write yet.

- 2f17498: Rename `@laikacms/decap` to `@laikacms/server` and drop the `decap-` prefix from its
  modules.

  Neither module was ever Decap-specific: `decap-api` is a composition router over the `laikacms`
  JSON:API sub-APIs behind one auth boundary, and `decap-oauth2` is a self-contained OAuth 2.0
  authorization server that does not need the CMS API to exist. Only the naming implied otherwise.

  **Subpaths**

  | Before                                      | After                                  |
  | ------------------------------------------- | -------------------------------------- |
  | `@laikacms/decap/decap-api`                 | `@laikacms/server/api`                 |
  | `@laikacms/decap/decap-oauth2`              | `@laikacms/server/oauth2`              |
  | `@laikacms/decap/decap-oauth2/i18n`         | `@laikacms/server/oauth2/i18n`         |
  | `@laikacms/decap/decap-oauth2/i18n/{en,nl}` | `@laikacms/server/oauth2/i18n/{en,nl}` |
  | `@laikacms/decap/decap-cms-backend-laika`   | `@laikacms/decap-cms/backends/laika`   |

  **Symbols**: `decapApi` -> `laikaApi`, `DecapApi` -> `LaikaApi`, `DecapOptions` ->
  `LaikaApiOptions`, `decapOauth2` -> `laikaOauth2`, `DecapOauth2` -> `LaikaOauth2`. The
  module-augmentation targets moved with the subpaths (`declare module '@laikacms/server/api'`).

  There are no compatibility aliases; `@laikacms/decap` is deprecated on npm.

  **The Decap CMS backend left this package entirely.** `createLaikaBackend()` /
  `resolveLaikaBackend()` now ship only with the fork, as `@laikacms/decap-cms/backends/laika`. The
  copy here had drifted behind the fork's, so it was deleted rather than merged. As a result
  `@laikacms/server` no longer has `react` or `@laikacms/decap-cms` peer dependencies, and its only
  runtime dependency is `laikacms`.

  **User-visible defaults rebranded from "Decap CMS" to "Laika CMS":** login page titles
  (`oauth2/i18n` en + nl), the transactional-email `appName`, and the TOTP `issuer`
  (`DEFAULT_TOTP_ISSUER`, now exported from `@laikacms/server/oauth2`).

  The TOTP change needs action if you have enrolled users. The issuer is the label in the
  authenticator app and is baked into every already-minted `otpauth://` URI, so a deployment that
  relied on the old default must now set it explicitly to keep existing enrollments matching:

  ```ts
  laikaOauth2({
    // …
    totp: { enabled: true, issuer: 'Decap CMS', callbacks },
  });
  ```

  Deployments with no enrolled users, or that already set `totp.issuer`, are unaffected.

### Patch Changes

- Updated dependencies [2f17498]
- Updated dependencies [2f17498]
- Updated dependencies [2f17498]
  - laikacms@5.0.0

## 3.1.0

### Minor Changes

- Add the `laikacms/auth` core subpath and an opt-in scope authorization policy in decap-api.

  `laikacms/auth` consolidates the PAT + scope mechanism as the lowest auth layer: an open
  `resource:action` scope vocabulary with wildcards (`hasScope`, `normalizeScopes`), PAT
  mint/hash/verify (`lk_pat_` prefix, sha256 at rest, timing-safe compare), and `resolveBearer` —
  one seam turning a bearer token into `{ user, scopes }` — plus `requireScope` enforcement.

  decap-api consumes it and adds `createScopePolicy()`, a drop-in `authorize()` that grants a
  request iff the principal's `user.scopes` satisfy the scope required for its domain+operation.
  Fails closed. `User.scopes` is optional and the PAT/bearer helpers are re-exported so consumers
  can wire scoped bearers into `authenticateAccessToken` from one import.

- Harden the decap-oauth2 authentication flows: add a runtime safety gate with unique reason codes
  (opt-out via `ignoreUnsafeReasons`), strengthen the passkey and TOTP flows, and tighten the OAuth2
  handlers and HTML templates.

### Patch Changes

- decap-cms-backend-laika: stop the dev authentication page from repeatedly re-attempting login.
- Updated dependencies
- Updated dependencies
  - laikacms@3.1.0

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
