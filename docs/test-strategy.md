# Test Strategy

This document captures the current state of automated testing across the Laika CMS monorepo and the
plan to close the gaps. It is intentionally prescriptive: it names which packages to start with,
why, and in what order.

## Current state

Vitest 4.x is wired into the workspace catalog and Turbo has a `test` task, but the repo currently
ships **zero test files** across all 39 packages. Five packages declare a `test` script
(`vitest run`) — `@laikacms/crypto`, `@laikacms/file-sanitizer`,
`@laikacms/contentbase-settings-ddb`, `@laikacms/contentbase-settings-default`, and
`@laikacms/documents-contentbase` — but none of them contain any tests, so the suites pass
vacuously.

| Metric                                            | Value |
| ------------------------------------------------- | ----- |
| Source files (`.ts`/`.tsx`, excluding `.d.ts`)    | ~241  |
| Test files (`*.test.*`, `*.spec.*`, `__tests__/`) | 0     |
| Packages with a `test` script                     | 5     |
| Packages with actual tests                        | 0     |
| Coverage tooling configured                       | None  |

## Where to invest first

The priorities below are ordered by risk reduction per hour of work.

### 1. Security-critical primitives

These modules are where bugs become CVEs.

- **`packages/shared/crypto`** (`constant-time.ts`, `hash.ts`, `password.ts`, `random.ts`,
  `timing.ts`). Use known-answer test vectors from RFCs/NIST, property-test that constant-time
  comparisons do not short-circuit, fuzz password hashing parameters, and assert non-determinism
  plus entropy on `random`.
- **`packages/decap/decap-oauth2`** (27 source files including `passkey/`, `totp/`, OAuth2 flow).
  Cover PKCE state/nonce handling, TOTP RFC 6238 vectors, replay-attack rejection, passkey challenge
  verification, and redirect-URI allowlisting.
- **`packages/shared/file-sanitizer`** (16 files: jpeg/gif/webp/png sanitizers). Feed real
  EXIF-laden samples and assert metadata is stripped. Add malformed-input/fuzz tests so a crafted
  file cannot crash the parser.

### 2. Domain contracts

Domain packages define the interfaces every implementation depends on. Drift here breaks everything
downstream.

- **`packages/domain/storage`** — repository, provider, format, serializer roundtrips, cache
  invalidation rules.
- **`packages/domain/documents`** — revision lifecycle (`revision.ts`, `revision-create.ts`,
  `revision-summary.ts`) and repository CRUD invariants.
- **`packages/domain/assets`** — asset URL generation and create/update flows.

The pattern: each domain package should export a **shared conformance test suite** that any
implementation can re-run against itself. See section 3.

### 3. Storage adapter conformance

`storage-fs` and `storage-r2` both implement the same abstract `StorageRepository`. They should
share one parametrized suite (read/write/list/delete/concurrent-write semantics) executed once with
the FS adapter and once against R2 via miniflare or a mocked binding. Same approach for `assets-r2`
and the `documents-drizzle`/`storage-drizzle` adapters.

### 4. Serializers

`storage-serializers-{json,markdown,yaml,raw}` are 1-file packages. Roundtrip tests
(`serialize ∘ deserialize === id`) plus a few golden-file fixtures cost roughly 30 minutes per
package and lock in behavior permanently.

### 5. JSON:API surface

`packages/shared/json-api`, the four `*-api` packages, and the three `*-jsonapi-proxy` impls all
share the JSON:API wire format. A single fixture-driven contract test, run against both proxies and
servers, is enough to catch most regressions.

### 6. Don't add a `test` script until there are real tests

Several packages used to declare `"test": "vitest run"` with no test files, so CI passed vacuously.
The fix is not "add a smoke test" — structural smoke tests (asserting a class is a function, that
methods exist on the prototype, etc.) test TypeScript rather than behavior, never catch real
regressions, and just get in the way of refactors. The fix is to remove the `test` script until
there are tests worth running.

## Repo-wide gaps

- **No coverage reporting.** Add `@vitest/coverage-v8`, set thresholds in a shared
  `vitest.config.ts`, and surface coverage in CI.
- **No enforcement that packages opt into tests.** Only 5 of 39 packages declare a `test` script.
  `scripts/validate-packages.ts` is the natural place to require one.
- **No shared test utilities package.** Worth adding `packages/shared/testing` for fixtures,
  in-memory mocks, and the domain conformance suites mentioned above.
- **No integration test layer.** Once unit tests exist, add a small e2e harness that boots a `*-api`
  server against an in-memory impl and exercises real HTTP.

## Rollout order

1. Wire up `@vitest/coverage-v8` and a shared baseline `vitest.config.ts` template (see
   `vitest.config.base.ts` at the repo root).
2. Cover `shared/crypto` and `shared/file-sanitizer`.
3. Add domain conformance suites in `domain/storage`, `domain/documents`, `domain/assets`.
4. Run those suites against `storage-fs`, `storage-r2`, `assets-r2`.
5. Roundtrip tests for all four serializers.
6. OAuth2 flow tests in `decap-oauth2`.
7. JSON:API contract tests across `*-api` and `*-jsonapi-proxy`.
