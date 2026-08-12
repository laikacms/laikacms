# `laikacms/catalog-convention`

A `CatalogProvider` implementation that derives collection settings by convention — collection names
map to same-name folders — and persists catalog settings and per-collection schemas into the
underlying `StorageRepository`, rather than requiring a hand-authored config file.

## Why convention-based catalog settings?

It's the simplest way to wire up Catalog: no config file to seed ahead of time. The first time a
collection is asked about, `ConventionCatalogProvider` synthesizes sensible defaults (folder named
after the collection key, revisions under `.laika/revisions/<collection>`, etc.) in memory. Nothing
is written to storage until you explicitly call `putCatalog`, `putDocumentCollectionSettings`,
`putMediaCollectionSettings`, or `putCollectionSchema` — at which point the settings become the
persisted source of truth for subsequent reads. Good fit for setups where the folder layout is
predictable and you don't need a separate editor-facing config format.

## Usage

```ts
import { ConventionCatalogProvider } from 'laikacms/catalog-convention';
import { runTask } from 'laikacms/compat';
import { jsonSerializer } from 'laikacms/serializers/json';
import { FileSystemStorageRepository } from 'laikacms/storage/fs';

const storage = new FileSystemStorageRepository(
  '/path/to/content',
  { json: jsonSerializer },
  'json',
);

const catalog = new ConventionCatalogProvider({ storage });

// No settings file needed — defaults are synthesized on first read.
const postsSettings = await runTask(catalog.getDocumentCollectionSettings('posts'));

// Persist a customized setting; subsequent reads pick it up from storage.
await runTask(
  catalog.putDocumentCollectionSettings('posts', {
    ...postsSettings,
    name: 'Blog Posts',
  }),
);
```

### Constructor options

`ConventionCatalogProvider` takes a single options object:

| Option    | Required | Description                                                                                                                           |
| --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `storage` | yes      | The `StorageRepository` used both to persist catalog settings/schemas and, implicitly, to back the collections the catalog describes. |

## Behaviour notes

- **Persistence.** Catalog-wide settings (`getCatalog` / `putCatalog`) are stored at the
  extensionless key `.laika/catalog`; per-collection JSON schemas (`getCollectionSchema` /
  `putCollectionSchema`) are stored at `.laika/schemas/<collection>`. Both are written with
  `metadata: { extension: 'json' }`, so the storage repository's serializer registry must have a
  `json` serializer registered (a startup warning is logged if it doesn't, or if the storage doesn't
  support file extensions at all).
- **Defaults without seeding.** `getCatalog()` returns `createDefaultCatalog()` in memory (without
  writing it to storage) when no `.laika/catalog` object exists yet. Similarly,
  `getDocumentCollectionSettings` / `getMediaCollectionSettings` synthesize a default settings
  object — folder = collection key, name = start-cased collection key, `recursive: true` — when the
  collection isn't present in the persisted catalog.
- **Type mismatch guard.** Asking for `getDocumentCollectionSettings('x')` when `'x'` is configured
  as a `media` collection (or vice versa) fails with `InvalidData` rather than silently returning
  the wrong shape.
- **Writes go through `putCatalog`.** `putDocumentCollectionSettings` and
  `putMediaCollectionSettings` both read the current catalog, merge in the new collection entry, and
  write the whole catalog back — there's no partial/collection-scoped write path.
