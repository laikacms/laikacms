# laikacms

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
