# laikacli

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
