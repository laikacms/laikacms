---
"@laikacms/astro": minor
"laikacms": minor
---

Type live collections from the catalog, and map the Decap widgets whose value shape their config
decides.

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
  `pattern` that is not a usable regex is dropped rather than emitted into a schema no validator can
  load.

`jsonSchemaToZod` and the entry-type renderer both learned `anyOf`, which is what makes the
variable-type lists reach `entry.data` as a real discriminated union instead of `unknown`.
