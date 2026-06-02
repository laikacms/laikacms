# laikacms

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
  - First publish of `@laikacms/decap-integrations` — the package was previously published as
    `@laikacms/decap`; this is a rename with the same content tree plus the new `./embedded` subpath
    (`createEmbeddedLaika`) and the dev-token auth flow.

## 1.0.0

### Major Changes

- Integrated with effect channels and changed the interfaces

  This is a breaking change because it includes changes to the interfaces of the repositories.

## 0.1.2

### Patch Changes

- Moved to hybrid monorepo structure
