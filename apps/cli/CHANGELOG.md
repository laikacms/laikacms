# laikacli

## 0.2.1

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

## 0.2.0

### Minor Changes

- 2f17498: Make the CMS a plug-in choice instead of a hardcoded dependency. A `CmsAdapter`
  (`src/cms/types.ts`) now owns everything about one admin UI — its npm package, its
  backend/widget/codec/locale catalogs, the codegen for the generated app's `src/cms.ts`, and its
  typed-config codegen — and adapters are resolved from a registry (`src/cms/registry.ts`). Decap
  moves behind that interface as `decapAdapter`; nothing outside `src/cms/decap*.ts` knows what a
  Decap import looks like.

  Both `create` and `local generate` take a `--cms` flag. Decap is the only adapter, so the wizard
  skips the question and uses it — the same way it skips the starter question while one starter is
  enabled. The `--backends`, `--widgets`, and `--locales` prompts and flags now read the selected
  CMS's catalogs rather than Decap's globals, and a CMS with an empty catalog is simply never asked
  about it. `CmsSelection` gained an `adapter` field naming the CMS it belongs to.

  Programmatic API: `cmsAdapters`, `DEFAULT_CMS_ADAPTER`, `findCmsAdapter`, `getCmsAdapter`, and
  `decapAdapter` are exported from the package root, along with the `CmsAdapter`,
  `CmsConfigCodegen`, `CmsConfigDiscovery`, `CmsExtension`, and `CmsSelection` types.
  `DiscoverResult` is renamed `CmsConfigDiscovery`; `discoverConfig`, `generateConfig`,
  `loadConfig`, `serialize`, and `writeGenerated` are unchanged but now reached through
  `decapAdapter.config` inside the CLI.
