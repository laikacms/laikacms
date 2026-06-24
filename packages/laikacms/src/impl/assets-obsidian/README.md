# laikacms/assets-obsidian

Obsidian-vault-backed implementation of `AssetsRepository`.

> **Runtime: Node.js / Bun only.** This module imports `node:fs`, `node:path`, and `node:stream`. It
> cannot run on Cloudflare Workers or other edge runtimes. Use `laikacms/assets-r2` for
> edge-compatible asset storage.

## Usage

```ts
import { ObsidianAssetsRepository } from 'laikacms/assets-obsidian';

// minimal — vault path only
const assets = new ObsidianAssetsRepository('/path/to/your/obsidian-vault');

// with options
const assets = new ObsidianAssetsRepository('/path/to/your/obsidian-vault', {
  attachmentsDirectory: 'attachments',
});
```

Every non-markdown file in the vault (images, PDFs, audio, …) is exposed as an `Asset` keyed by its
vault-relative path. The implementation is read-oriented — for write-heavy workloads prefer
`laikacms/assets-r2` or another object-storage backend.

## Limitations

Obsidian vaults store no per-file custom metadata or cache headers, so `updateAsset` is unsupported:

| Method        | Behaviour                                                                       |
| ------------- | ------------------------------------------------------------------------------- |
| `updateAsset` | Always throws `BadRequestError`. Use `createAsset` to replace the file instead. |
