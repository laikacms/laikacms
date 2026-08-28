# @laikacms/github

## 2.0.0

### Major Changes

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
