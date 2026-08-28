# @laikacms/astro

## 6.0.0

### Minor Changes

- 06b4a5a: Add `@laikacms/astro`: a first-class Astro integration built on the Content Layer.

  - `documentsLoader()` / `objectsLoader()` for `defineCollection({ loader })`, so Astro pages use
    `getCollection`, `getEntry` and `render` instead of the `laika:` import protocol.
  - Incremental sync with four tiers — change feed, version tokens, content digest, full reload —
    chosen from what the repository advertises through `getCapabilities()`, degrading cleanly to the
    digest tier on repositories (including the filesystem/Catalog default) that advertise nothing.
  - Schema derivation from the catalog: pass `z` and a collection's Zod schema _and_ its entry types
    are generated from your existing CMS config, so fields are declared in one place. Collections
    whose catalog describes no fields get entry types inferred from their content instead. Both go
    through Astro's own `Loader.createSchema()`, landing in `.astro/loaders/`.
  - `laika()` integration mounting the dev-only JSON:API and bridging repository change
    notifications to Astro's `refreshContent`, so CMS edits appear without restarting the dev
    server.
  - `api.mode: 'route'` for deployments: an injected on-demand route serving the same JSON:API,
    limited by `access` to published reads (default), all reads, or reads and writes. The policies
    are allowlists and check listing filters, so drafts cannot leak through `filter[type]`.
  - `liveDocumentsLoader()` for `defineLiveCollection()`, enabling draft preview at request time.

  `starter-astro-blog` and `apps/website` now read content through `astro:content`; the Astro
  starter renders post bodies as real HTML via `render(entry)` instead of dumping markdown into a
  `<pre>`.

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

### Patch Changes

- Updated dependencies [e8ab49b]
- Updated dependencies [14df4cf]
- Updated dependencies [387a1b4]
- Updated dependencies [06b4a5a]
- Updated dependencies [e8ab49b]
- Updated dependencies [14df4cf]
- Updated dependencies [e8ab49b]
- Updated dependencies [6b918c6]
  - laikacms@6.0.0
  - @laikacms/vite-plugin@6.0.0
