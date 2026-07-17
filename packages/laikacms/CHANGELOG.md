# laikacms

## 1.3.0

### Minor Changes

- 42363a1: The JSON:API proxy repositories (storage, documents, assets) now send all requests
  through an Effect `HttpClient` via a shared `JsonApiHttpTransport`. Each repository accepts an
  optional `httpClient` option so a composition root can share one connection-pooled client (e.g.
  built with the new `httpClientFromFetch` helper in `laikacms/json-api` around an undici Agent)
  across all proxy repositories for TCP/TLS session reuse. Defaults to a `globalThis.fetch`-backed
  client, resolved at request time. Network failures in the storage proxy now surface as typed
  `InvalidData` errors instead of defects.

  Fixed: a `LaikaTask.make` / `LaikaStream.make` builder that died with a defect (a thrown
  non-`LaikaError`) silently killed the forked builder fiber without terminating the queue, hanging
  every consumer forever. Defects now propagate to the consumer as a rejected cause.

## 1.2.0

### Minor Changes

- 827ffe2: **BREAKING (alpha): `documents-api` POST `/operations` — fail-fast batch semantics
  (ADR-004, LCMS-402)**

  The `/operations` endpoint has been updated to drop the JSON:API Atomic Operations vocabulary and
  implement honest fail-fast batch semantics:

  - **Request key renamed**: `atomic:operations` → `operations`
  - **Response key renamed**: `atomic:results` → `results`
  - **Pre-flight validation**: all operations are shape-validated before any I/O; a batch with any
    malformed op (e.g. `add` missing `data.id`) returns HTTP 400 with zero writes
  - **Sequential application**: operations are now applied in order rather than concurrently; the
    first repository failure stops processing — no subsequent ops run
  - **Explicit semantics**: a mid-batch repository failure leaves previously-applied ops applied;
    this endpoint is a fail-fast batch, not a transaction

  This is a wire-breaking change to a public export (`laikacms/documents/api`) of a published
  package, shipped as `minor` because the project is in alpha and breaking changes are expected.
  There are no in-repo consumers of the old vocabulary — the Decap backend does not call
  `/operations`, and `storage-jsonapi-proxy` targets the _storage-api_ `/operations` endpoint, whose
  `atomic:*` vocabulary is deliberately unchanged.

  **Migration:** rename the request key `atomic:operations` → `operations` and read results from
  `results` instead of `atomic:results`. Batches that previously returned `200` with a mix of
  successes and per-op errors now return `400` with zero writes if any op is shape-invalid, and stop
  at the first repository failure otherwise.

  Note: the **storage-api** `/operations` endpoint is untouched and still speaks `atomic:operations`
  / `atomic:results`. Only the documents-api endpoint changes.

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

## 1.1.0

### Minor Changes

- 96f8692: Large stabilization release with pagination, error-handling, and Decap backend fixes
  across all API packages.

  **Pagination correctness**

  - `done.total` now returns the full matching count (not the page count) in storage-drizzle,
    documents-drizzle, documents-obsidian, documents-contentbase, and assets repositories.
  - Decap backend `getMedia()`, `unpublishedEntries()`, and `entriesByFolder()` now paginate past
    100 records instead of silently capping; `traverseCursor()` actually advances pages.
  - `listAtoms` no longer silently caps at 20 rows when `pagination.limit` is absent.
  - Cursor pagination is rejected with a clear error when the backend declares `cursor: false`;
    standalone `page[size]` is honoured and defaults to page-based links; assets-api aligned to the
    shared `page[after]`/`page[before]`/`page[size]` codec.

  **HTTP status & error mapping**

  - API handlers consistently derive HTTP status from `ErrorCodeToStatusMap` (documents-api,
    assets-api, storage-api, atomic operations, `/capabilities`).
  - Malformed JSON bodies and query-decode failures return `invalid_data`/400 instead of 500 or a
    hang; missing resources return 404 instead of 400; PATCH with mismatched `data.id` returns 409
    Conflict.
  - `documents-jsonapi-proxy` re-hydrates typed `LaikaError`s from the JSON:API `code` field; mapped
    errors no longer leak internal paths and stack traces.
  - storage-fs maps permission errors to `ForbiddenError` (EACCES typo fix) and rejects object keys
    that escape the content root.

  **Decap integration**

  - `ExtractFieldType` infers `Array<T>` for `multiple: true` on select/image/file/relation fields.
  - Icon widgets get distinct names (no more silent overwrite); browser subpath imports include
    `.js` extensions; peer dependencies point at the renamed `@laikacms/decap-cms` fork.
  - `getMedia()` recoverable warnings route through the `onWarning` handler.
  - decap-api: opt-in CORS with OPTIONS preflight handled before auth, `?api_key=` URL params
    rejected before Bearer auth, `application/json` Content-Type on `/session`, and OAuth
    `authorizeEndpoint`/`tokenEndpoint` config wired into routing.
  - decap-ai: widget defaults to English i18n, server adapter and widget agree on `/api/ai` base
    path, session callbacks no longer cause unhandled rejections.

  **API surface & configuration**

  - storage-api: `DELETE /objects/:key` added (with 405 for unsupported verbs), `POST /atoms`
    create-folder endpoint documented and tested, unknown attribute keys rejected on POST/PATCH.
  - `logger` and `onError` options added to assets-api, contentbase-api, and decap-api (forwarded to
    `buildAssetsApi`); hardcoded `console.error` calls removed.
  - CAPTCHA CSP is provider-agnostic via `captchaCspAdditions`; `createVariations` option wired into
    asset repositories.
  - `engines.node` widened from `22.x` to `>=22.0.0`.

- 96f8692: Add OpenAPI 3.1 specifications to all four API packages (assets-api, contentbase-api,
  documents-api, storage-api). Each package now exports a `build*OpenApi({ basePath })` builder
  returning a typed `OpenApiDocument`, and each server serves its spec at
  `GET {basePath}/openapi.json`. Shared OpenAPI authoring types are exported from
  `laikacms/json-api`.

## 1.0.1

### Patch Changes

- e488528: Build hygiene + decap-ai compatibility fixes.
  - `@laikacms/decap-ai` — bridge `react-redux@7` `connect()`'s React-18 type surface to React 19's
    `ReactNode` (which adds `bigint | Promise<ReactNode>`) so the package's `.d.ts` emits cleanly
    for downstream consumers without an `as any` cast on the component.
  - All publishable packages — exclude `**/*.test.ts` and `**/__tests__/**` from the production
    `tsc` build. Tests aren't shipped to npm and a few contract-testkit suites have latent type
    errors that surfaced once turbo's cache was invalidated; excluding them unblocks a clean build
    without touching the (passing) test code.
  - `@laikacms/decap` — adds the new `./embedded` subpath (`createEmbeddedLaika`) and the dev-token
    auth flow.

## 1.0.0

### Major Changes

- Integrated with effect channels and changed the interfaces

  This is a breaking change because it includes changes to the interfaces of the repositories.

## 0.1.2

### Patch Changes

- Moved to hybrid monorepo structure
