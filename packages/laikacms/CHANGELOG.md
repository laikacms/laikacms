# laikacms

## 6.0.0

### Major Changes

- e8ab49b: Rename ContentBase to Catalog, and move its storage layout under `.laika/`.

  "ContentBase" named the opinionated layer of the protocol — the named document and media
  collections projected onto generic atoms and folders — but read like a product name and said
  nothing about collections. Worse, the JSON:API it serves already spoke a different word for the
  same thing (`/collections`, `document-collection`, `media-collection`), so the codebase carried
  two vocabularies for one concept. It is now the **catalog**: a catalog contains collections.

  Subpath exports:

  | before                                  | after                         |
  | --------------------------------------- | ----------------------------- |
  | `laikacms/contentbase-settings`         | `laikacms/catalog`            |
  | `laikacms/contentbase-api`              | `laikacms/catalog-api`        |
  | `laikacms/documents/contentbase`        | `laikacms/documents/catalog`  |
  | `laikacms/assets/contentbase`           | `laikacms/assets/catalog`     |
  | `laikacms/contentbase-settings-default` | `laikacms/catalog-convention` |
  | `laikacms/contentbase-settings-decap`   | `laikacms/catalog-decap`      |

  Identifiers: `ContentBaseSettingsProvider` → `CatalogProvider`, `ContentBaseSettings` → `Catalog`,
  `DefaultContentBaseSettingsProvider` → `ConventionCatalogProvider`,
  `DecapContentBaseSettingsProvider` → `DecapCatalogProvider`, `ContentBaseDocumentsRepository` →
  `CatalogDocumentsRepository`, `ContentBaseAssetsRepository` → `CatalogAssetsRepository`,
  `buildContentbaseOpenApi` → `buildCatalogOpenApi`. On `CatalogProvider`,
  `getSettings`/`putSettings` are now `getCatalog`/`putCatalog` — the per-collection accessors are
  unchanged. The JSON:API wire format does not change: resource types stay
  `document-collection`/`media-collection` and the routes stay `/collections`.

  `laikacms/catalog-convention` now persists to `.laika/catalog`, `.laika/schemas/<collection>` and
  `.laika/revisions/<collection>` instead of `.contentbase/…`. Keys stay extensionless so the
  storage repository's configured serializers decide the format. Where a catalog lives is the
  provider's business, not the contract's — `catalog-decap` still reads its `configKey` object, and
  a database provider has no path at all.

  `@laikacms/vite-plugin` moves its generated output from `.laika/` to `.laika/vite-generated/`, so
  the two lifecycles no longer share a directory: everything directly under `.laika/` is durable
  state that belongs in git, and only `vite-generated/` is ignored. The plugin now appends
  `.laika/vite-generated/` to the project `.gitignore` (not `.laika/`) and writes `vite-generated/`
  into `.laika/.gitignore`. Update the reference in your committed `laika-env.d.ts`:

  ```ts
  /// <reference path="./.laika/vite-generated/types.d.ts" />
  ```

  A project that previously had a bare `.laika/` rule in `.gitignore` must narrow it, or its catalog
  will never be committed.

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

- 6b918c6: Rename `AuthorizationError` to `UpstreamUnAuthorizedError`, and stop using it for
  authorization denials.

  The old name promised the wrong thing. `AuthorizationError` reads as "authorization failed", but
  the class is HTTP 401 and its actual job is narrow: it is the deserialization target for a 401
  challenge this server received from an _upstream_ — nothing to do with "authenticated but not
  permitted". That mismatch was actively misleading people (laikacms#851 proposed routing
  authorization denials through it, which would have answered 401 to callers who are in fact
  authenticated).

  The auth vocabulary is now unambiguous:

  | Case                                            | Error                       | Status |
  | ----------------------------------------------- | --------------------------- | ------ |
  | Caller has not proven who they are              | `AuthenticationError`       | 401    |
  | Caller is authenticated but not permitted       | `ForbiddenError`            | 403    |
  | An upstream rejected _this server's_ credential | `UpstreamUnAuthorizedError` | 401    |

  The wire code is unchanged (`unauthorized`), so JSON:API error payloads and the proxy's
  `rehydrateErrorCodes` round-trip are unaffected. The exported `errorCode`/`errorStatus` key moved
  from `AUTHORIZATION_ERROR` to `UPSTREAM_UNAUTHORIZED`.

  Two mapping bugs surfaced by the rename are fixed as part of it:

  - **GitHub 403 returned 401.** `GithubDataSource.mapError` mapped a GitHub `403` to the 401 class,
    so a permission denial told callers to re-authenticate when their token was valid but
    under-scoped. It now returns `ForbiddenError` (403), matching the GitLab and Bitbucket
    datasources.
  - **Upstream 401s claimed the caller was unauthenticated.** All three git-host datasources mapped
    an upstream `401` to `AuthenticationError`, which means "_this_ server rejected your
    credential". A git host rejecting the server's own token is a different failure, and now returns
    `UpstreamUnAuthorizedError`. Status is unchanged (both are 401); only the error code and message
    change.

### Minor Changes

- 06b4a5a: Type live collections from the catalog, and map the Decap widgets whose value shape their
  config decides.

  **Live collections are no longer `Record<string, unknown>`.** Astro gives a live loader no
  `createSchema()` hook, so `laika()` now reads the catalog at `astro:config:done` and emits a
  `LaikaLiveCollections` augmentation into `.astro/`. Passing an explicit `collection` to
  `liveDocumentsLoader()` picks up that collection's shape; a collection the catalog cannot describe
  is not a member and stays `Record<string, unknown>`, as does omitting `collection`. A project can
  override any member by augmenting `@laikacms/astro/live-collections` itself.

  Dates come through as `string | Date` there rather than `Date`: nothing coerces on the live path
  unless that loader opted into validation, and the build-time `Date` would have been a claim the
  checker cannot catch.

  **`liveDocumentsLoader({ validate: { catalog, z } })`** validates entries against the
  catalog-derived schema at request time. Off by default — a build-time collection is validated once
  per build, this runs per request — and the schema is derived once per collection rather than once
  per request. A mismatch surfaces as `ValidationError` on the result's `error`, not a throw.

  **`DecapCatalogProvider` now maps the widgets whose stored value depends on their own config:**

  - `code` produces the object it really stores (`{ code, lang }`, honouring `keys`), and a bare
    string only under `output_code_only`. It was previously typed as a string always.
  - `list` with `types` produces a union of the declared variants, each tagged under the list's
    `typeKey` (default `type`). It previously fell through to `Array<string>`.
  - `number` carries `min`/`max` as `minimum`/`maximum`, multi-`select` carries them as
    `minItems`/`maxItems`, string fields carry `pattern`, and any field carries its `default`. A
    `pattern` that is not a usable regex is dropped rather than emitted into a schema no validator
    can load.

  `jsonSchemaToZod` and the entry-type renderer both learned `anyOf`, which is what makes the
  variable-type lists reach `entry.data` as a real discriminated union instead of `unknown`.

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

- 14df4cf: Shrink the OpenAPI documents served by the four JSON:API handlers and stop shipping them
  to deployments that never ask for one.

  The specs were four hand-maintained copies of the same JSON:API vocabulary and had drifted apart:
  the assets spec required only `status`/`code` on an error object the runtime always fills with
  four members, catalog omitted `code` and `source` entirely, and every spec advertised a
  `links.last` no link builder can produce. That vocabulary now lives once in `laikacms/json-api` as
  `jsonApiErrorComponents`, `jsonApiLinkComponents`, `capabilityComponents`, `apiInfoComponents` and
  `paginationParameters`, so all four surfaces describe the runtime identically.

  New in `laikacms/json-api`: `compactOpenApiDocument`, which hoists response bodies and query
  parameters that repeat across operations into `components` and replaces each occurrence with a
  `$ref`. Operations keep their own wording — OpenAPI 3.1 allows a `description` alongside `$ref` —
  so the pass is lossless once dereferenced. Served documents shrink by 3–14% (documents 41.5 KB →
  35.9 KB, storage 30.0 KB → 27.0 KB).

  The spec builders are now loaded on demand by their handlers instead of statically imported, so a
  bundler puts each one in its own chunk (~30 KB for documents) rather than the startup path of
  every worker that mounts the API. `buildDocumentsOpenApi`, `buildStorageOpenApi`,
  `buildAssetsOpenApi` and `buildCatalogOpenApi` remain exported and unchanged in signature.

  Also corrects the storage spec's `atomic:results`, which documented failed operations as always
  omitted: a failed remove keeps its slot as an `errors` entry so callers stay index-aligned with
  the keys they requested.

  Component schema names changed in the served documents — notably the assets spec's `ErrorObject`
  is now `JsonApiErrorObject`, and catalog's `JsonApiError`/`JsonApiErrorDocument` are now
  `JsonApiErrorObject`/`JsonApiError` — so anything generating clients from a pinned copy of a
  document should regenerate.

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

- 387a1b4: Remove Hono dependency from `laikacms` core — `catalog-api` now uses a plain
  `{ fetch(request: Request): Promise<Response> }` handler matching the sibling APIs
  (`documents-api`, `assets-api`, `storage-api`). Drops `hono` and `@hono/node-server` from
  `peerDependencies`.

### Major Changes

- e8ab49b: **Breaking:** rename `ContentBase` to `Catalog` — all `contentbase` subpaths
  (`laikacms/assets-contentbase`, `laikacms/documents-contentbase`,
  `laikacms/contentbase-settings-default`, `laikacms/contentbase-settings-decap`,
  `laikacms/contentbase-api`) are replaced by their `catalog` equivalents
  (`laikacms/assets-catalog`, `laikacms/documents-catalog`, `laikacms/catalog-convention`,
  `laikacms/catalog-decap`, `laikacms/catalog-api`). Update all imports.

- 676fae09: **Breaking:** `catalog-api` no longer exports a Hono app — it returns a plain `fetch`
  handler instead.

- e8ab49b: **Breaking:** `laikaApi` now requires an `authorize` option; the option is no longer
  optional.

- e8ab49b: **New:** Node 22 is now supported.

## 5.0.0

### Minor Changes

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

- 2f17498: Add `laikacms/storage/web-fs` — a `WebFsStorageRepository` implementing the
  `StorageRepository` contract against the browser's File System API: any
  `FileSystemDirectoryHandle`, whether the origin-private file system root (the default), a
  user-picked `showDirectoryPicker()` directory, or an injected shim. Real directory hierarchy
  (empty folders without `.keep` markers), raw file contents, namespace subdirectory isolation, lazy
  SSR-safe resolution of `navigator.storage.getDirectory()`, and typed error mapping for quota,
  traversal, and non-empty-folder deletion.

  Every operation re-validates the root handle before touching it — `queryPermission({ mode })` when
  the handle exposes it, plus a liveness probe — and fails with one of three new typed errors in
  `laikacms/core` that tell the application how to recover: `PermissionPromptRequiredError`
  (`permission_prompt_required`, 403 — re-request in a user gesture, retry), `PermissionDeniedError`
  (`permission_denied`, 403 — grant anew), or `StaleHandleError` (`stale_handle`, 410 — the
  directory is gone or the persisted handle expired, pick again). The repository never calls
  `requestPermission()` itself and does not care where a handle came from.

### Patch Changes

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

### Patch Changes

- storage-r2: preserve `createdAt` across object updates. R2's `uploaded` field resets on every
  `bucket.put()`, so the creation timestamp drifted forward on each update. The repository now
  embeds `x-laika-created-at` in custom metadata on first write and re-embeds it on every update,
  falling back to `uploaded` for objects written before this fix.

## 3.0.1

## 3.0.0

### Minor Changes

- 68c658f: New `laikacms/storage-github-cdn` export: a read-only `StorageRepository` backed by a
  **public** GitHub repository served over CDNs — no credentials and no `@octokit/*` dependency.
  Ships `GithubCdnStorageRepository` and its underlying `GithubCdnDataSource` (see the datasource
  for the metadata/freshness trade-offs). Writes reject; reads honour a configurable `ignoreList`
  (`.keep`, `.DS_Store`, `.contentbase`, … by default) and advertise `changes: unsupportedChanges`.

  The package now requires **Node `>=24`** (`engines.node` bumped from `>=22`).

- d26bdfe: New package `@laikacms/vite-plugin`: a Vite/Rolldown plugin that loads Laika CMS content
  as ES modules at build time via a `laika:` import protocol (`laika:doc/<key>`,
  `laika:store/<key>`). Each item is read from the documents or storage repository and emitted with
  one named export per field for tree-shaking; `import.meta.glob('laika:…')` is expanded by listing
  the repository (via `es-module-lexer` + `magic-string`, with sourcemaps). Because content is
  inlined at build time it works in a fully static, client-only build — no server, no JSON:API.
  Ships two more capabilities: TypeScript IntelliSense generated by running the TypeScript compiler
  over the real content data (so the compiler infers the types — zero drift), written to `.laika/` +
  a committed `laika-env.d.ts`; and dev-server hot reload driven by a new repository change channel.

  `laikacms` gains that change-channel primitive: `StorageRepository.subscribeChanges` plus a
  `changes` capability on the storage `Capabilities`. The base implementation is a no-op
  (`unsupportedChanges`); the filesystem repository implements a real push channel over a native
  recursive watch. Existing storage implementations advertise `changes: unsupportedChanges`.

## 2.2.0

## 2.1.1

### Patch Changes

- cc4d315: Clamp client-requested JSON:API page sizes to 100 for cursor, page-number, and offset
  pagination. This bounds the number of records buffered at API boundaries while preserving existing
  pagination semantics by reducing oversized requests instead of rejecting them.

  Package documentation now also:

  - warns that `buildJsonApi` does not provide authentication;
  - documents document and asset change-signal capabilities;
  - corrects pagination and storage API endpoint examples; and
  - expands the documented asset filter capabilities.

  The published package now includes an MIT `LICENSE` file.

## 2.1.0

### Minor Changes

- Add granular subpath exports so bundled consumers can avoid heavy barrels:

  - `laikacms/core/utilities` — dependency-free helpers (`memoize`, `lazy`, `Url`, `Paths`,
    `Header`, ...). `AsyncGenerator` moved to its own module (`async-generator.ts`) because
    `accumulateFirst` needs `effect/Result`; the `laikacms/core` barrel re-exports it, so the public
    API is unchanged.
  - `laikacms/crypto/*` — per-module crypto access (e.g. `laikacms/crypto/constant-time`) so
    importing `constantTimeEqual` no longer drags `bcryptjs` in via the `laikacms/crypto` star
    barrel.

## 2.0.0

### Patch Changes

- Fix the ContentBase documents repository silently discarding content edits in combined "change
  status + save content" PATCHes (LCMS-279). `updateUnpublishedStatus` now threads
  `content`/`language` through the status-change branch with the same merge semantics as a plain
  content update.
- Use named js-yaml imports in the YAML storage serializer so it works with js-yaml v5, which no
  longer provides a default export.
- Strip the domain `type` discriminator (and `id`) from JSON:API resource attributes per JSON:API
  §7.2.2 (LCMS-281). Previously the internal `type` field leaked into every `/documents`, `/assets`,
  and atomic-operations response; `fromJsonApi` now reinjects `type` from the resource envelope. If
  you were reading the non-spec `type` attribute off the wire, use the resource object's top-level
  `type` instead.

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
