---
"laikacms": patch
"@laikacms/server": patch
"@laikacms/github": patch
"@laikacms/gitlab": patch
"@laikacms/bitbucket": patch
"laikacli": patch
---

Fix `npx laikacli` crashing with `ERR_MODULE_NOT_FOUND` on `effect/unstable/http/Multipasta/Node`.

The catalog pinned `effect` and `@effect/platform-node` to `4.0.0-beta.66` while
`@effect/platform-node-shared` sat at `4.0.0-beta.104`. Under npm's hoisting,
`@effect/platform-node@beta.66`'s own `^4.0.0-beta.66` range on `platform-node-shared` resolved to a
newer beta whose `effect` peer pulled a newer `effect` to the tree root — so `platform-node@beta.66`
resolved a module path that no longer exists. pnpm's isolated `node_modules` masked this locally, so
only npm/npx consumers hit it.

The whole effect stack is now aligned on `4.0.0-beta.104`. What matters is that all three packages
are pinned to the _same_ version: npm then dedupes `platform-node`'s transitive caret onto the root
pin, so the tree stays consistent even after newer betas ship.

Also fixes two problems surfaced by the bump:

- `@laikacms/server` imported `effect/DateTime` and `effect/Result` without declaring `effect` as a
  dependency, resolving through a stale phantom symlink. It is now a declared dependency, which also
  makes the published package installable on npm.
- `effect/Schema`'s `decodeUnknownSync` now throws a real `SchemaError` rather than a plain `Error`
  carrying an `Issue` as its `cause`, so the documents-api error mapper detects it with
  `Schema.isSchemaError`. Without this, internal decode failures regressed from `400 invalid_data`
  to `500 internal_error`.
