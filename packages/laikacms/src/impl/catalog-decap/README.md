# `laikacms/catalog-decap`

A read-only `CatalogProvider` implementation that derives Catalog collection/schema settings from a
[Decap CMS](https://decapcms.org/) `config.yml`/`config.json` file already seeded into a
`StorageRepository`, instead of maintaining a separate Laika-native settings file.

## Why derive settings from a Decap config?

If you're running Decap CMS's editor UI alongside Laika (or migrating off it), the Decap config is
already the single source of truth for collections, folders, fields, and media.
`DecapCatalogProvider` reads that file and translates it into `Catalog` settings on the fly, so the
server and browser never have two configs to keep in sync. Because the Decap config is
authoritative, all `put*` methods are disabled — `DecapCatalogProvider` is intentionally read-only.

## Usage

```ts
import { DecapCatalogProvider } from 'laikacms/catalog-decap';
import { runTask } from 'laikacms/compat';
import { yamlSerializer } from 'laikacms/serializers/yaml';
import { FileSystemStorageRepository } from 'laikacms/storage/fs';

const storage = new FileSystemStorageRepository(
  '/path/to/content',
  { yaml: yamlSerializer },
  'yaml',
);

// Seed the Decap config once, e.g. via your app's setup script:
// await runTask(storage.createOrUpdateObject({
//   key: 'config',
//   type: 'object',
//   content: { collections: [...], media_folder: '/uploads', public_folder: '/uploads' },
//   metadata: { extension: 'yaml' },
// }));

const catalog = new DecapCatalogProvider({ storage, configKey: 'config' });

const postsSettings = await runTask(catalog.getDocumentCollectionSettings('posts'));
```

### Constructor options

`DecapCatalogProvider` takes a single options object (`DecapCatalogProviderOptions`):

| Option      | Required | Description                                                                                                                                                                                                                            |
| ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`   | yes      | The `StorageRepository` the Decap config is read from.                                                                                                                                                                                 |
| `configKey` | yes      | Logical key (with or without extension) of the Decap config file inside `storage`. Example: `'config'` resolves to `config.yaml`, `config.yml`, or `config.json` depending on which the storage's serializer registry can deserialize. |

## Behaviour notes

- **Read-only.** `putCatalog`, `putDocumentCollectionSettings`, `putMediaCollectionSettings`, and
  `putCollectionSchema` all fail with `InvalidData` ("edit it directly") — the Decap config is the
  source of truth and this provider never writes back to it.
- **Only folder collections translate.** Decap's `files`-style collections (fixed, named files) are
  skipped; only `folder` collections (with a `folder` + `fields`) become
  `DocumentCollectionSettings`.
- **Editorial workflow.** `unpublishedStatuses` is only populated on translated collections when the
  Decap config's top-level `publish_mode` is `'editorial_workflow'`.
- **Media settings use `public_folder`.** `getMediaCollectionSettings` isn't sourced from a Decap
  collection (Decap models media via the top-level `media_folder`/`public_folder`, handled elsewhere
  by the assets-catalog collection-prefix probe). Instead it reads the Decap config's
  `public_folder` and, if set, returns a `url` template of `${publicFolder}/{filename}` so asset
  URLs resolve to something the browser can load; if the config can't be read or `public_folder` is
  empty, it falls back to the same defaults as `catalog-convention`.
- **Schema derivation.** `getCollectionSchema` converts a Decap collection's `fields` into a
  `JSONSchema7` object. The common widgets (string/text/markdown/code/color/hidden, boolean, number,
  date/datetime, object, list, select, image/file/relation) are mapped explicitly; unknown widgets
  fall back to an unconstrained `{}` schema so downstream validators stay permissive. Required-ness
  follows Decap's convention: a field is required unless `required: false` is set explicitly.
  Requesting the schema for a Decap `files`-style collection (no single schema shape) fails with
  `InvalidData`.
