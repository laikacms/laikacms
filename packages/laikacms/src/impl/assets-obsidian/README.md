# laikacms/assets/obsidian

Obsidian-vault-backed implementation of `AssetsRepository`.

> **Runtime: Node.js / Bun only.** This module imports `node:fs`, `node:path`, and `node:stream`. It
> cannot run on Cloudflare Workers or other edge runtimes. Use `laikacms/assets/r2` for
> edge-compatible asset storage.

## Usage

```ts
import { ObsidianAssetsRepository } from 'laikacms/assets/obsidian';

// minimal — vault path only
const assets = new ObsidianAssetsRepository('/path/to/your/obsidian-vault');

// with options
const assets = new ObsidianAssetsRepository('/path/to/your/obsidian-vault', {
  attachmentsDirectory: 'attachments',
  documentExtensions: ['md', 'canvas'],
  ignore: ['.obsidian', '.git'],
  createUrl: key => `https://cdn.example.com/${key}`,
});
```

## Constructor

```ts
new ObsidianAssetsRepository(vaultPath: string, options?: ObsidianAssetsRepositoryOptions)
```

| Parameter   | Type                              | Description                          |
| ----------- | --------------------------------- | ------------------------------------ |
| `vaultPath` | `string`                          | Absolute path to the Obsidian vault. |
| `options`   | `ObsidianAssetsRepositoryOptions` | Optional configuration (see below).  |

## Options

| Option                 | Type                      | Default                                                     | Description                                                                                                  |
| ---------------------- | ------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `attachmentsDirectory` | `string`                  | `''` (vault root)                                           | Subdirectory treated as the asset root. Asset keys are resolved relative to it.                              |
| `documentExtensions`   | `string[]`                | `['md']`                                                    | File extensions (without the leading dot) excluded from listings because they belong to the documents layer. |
| `ignore`               | `string[]`                | `['.obsidian', '.trash', '.git', '.DS_Store', 'Thumbs.db']` | Directory / file basenames skipped while listing.                                                            |
| `createUrl`            | `(key: string) => string` | Returns the key unchanged                                   | Builds a serving URL for an asset key. Supply this to point at a static host or CDN.                         |

Every non-markdown file in the vault (images, PDFs, audio, …) is exposed as an `Asset` keyed by its
vault-relative path. The implementation is read-oriented — for write-heavy workloads prefer
`laikacms/assets/r2` or another object-storage backend.

## Filtering

`ObsidianAssetsRepository` supports a named `filter[search]` query parameter when listing resources
via the `assets-api`:

```
GET /resources?filter[search]=logo
```

This performs a **case-insensitive substring match on the resource key** — the example above returns
every asset whose key contains `"logo"` (e.g. `attachments/logo.png`, `images/logo-dark.svg`).

Sending an undeclared filter name (anything other than `search`) returns `400 Bad Request`. Inspect
`GET /capabilities` (`attributes.filtering.filters`) to see the current list of supported filter
names at runtime.

## Limitations

Obsidian vaults store no per-file custom metadata or cache headers, so `updateAsset` is unsupported:

| Method        | Behaviour                                                                       |
| ------------- | ------------------------------------------------------------------------------- |
| `updateAsset` | Always throws `BadRequestError`. Use `createAsset` to replace the file instead. |
