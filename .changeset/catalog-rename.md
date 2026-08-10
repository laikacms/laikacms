---
"laikacms": major
"@laikacms/vite-plugin": major
---

Rename ContentBase to Catalog, and move its storage layout under `.laika/`.

"ContentBase" named the opinionated layer of the protocol — the named document and media collections
projected onto generic atoms and folders — but read like a product name and said nothing about
collections. Worse, the JSON:API it serves already spoke a different word for the same thing
(`/collections`, `document-collection`, `media-collection`), so the codebase carried two
vocabularies for one concept. It is now the **catalog**: a catalog contains collections.

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
`buildContentbaseOpenApi` → `buildCatalogOpenApi`. On `CatalogProvider`, `getSettings`/`putSettings`
are now `getCatalog`/`putCatalog` — the per-collection accessors are unchanged. The JSON:API wire
format does not change: resource types stay `document-collection`/`media-collection` and the routes
stay `/collections`.

`laikacms/catalog-convention` now persists to `.laika/catalog`, `.laika/schemas/<collection>` and
`.laika/revisions/<collection>` instead of `.contentbase/…`. Keys stay extensionless so the storage
repository's configured serializers decide the format. Where a catalog lives is the provider's
business, not the contract's — `catalog-decap` still reads its `configKey` object, and a database
provider has no path at all.

`@laikacms/vite-plugin` moves its generated output from `.laika/` to `.laika/vite-generated/`, so
the two lifecycles no longer share a directory: everything directly under `.laika/` is durable state
that belongs in git, and only `vite-generated/` is ignored. The plugin now appends
`.laika/vite-generated/` to the project `.gitignore` (not `.laika/`) and writes `vite-generated/`
into `.laika/.gitignore`. Update the reference in your committed `laika-env.d.ts`:

```ts
/// <reference path="./.laika/vite-generated/types.d.ts" />
```

A project that previously had a bare `.laika/` rule in `.gitignore` must narrow it, or its catalog
will never be committed.
