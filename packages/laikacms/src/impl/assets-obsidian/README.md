# laikacms/assets-obsidian

Obsidian-vault-backed implementation of `AssetsRepository`.

> **Runtime: Node.js / Bun only.** This module imports `node:fs`, `node:path`, and `node:stream`. It
> cannot run on Cloudflare Workers or other edge runtimes. Use `laikacms/assets-r2` for
> edge-compatible asset storage.

## Usage

```ts
import { ObsidianAssetsRepository } from 'laikacms/assets-obsidian';

const assets = new ObsidianAssetsRepository({
  vaultPath: '/path/to/your/obsidian-vault',
});
```

Every non-markdown file in the vault (images, PDFs, audio, …) is exposed as an `Asset` keyed by its
vault-relative path. The implementation is read-oriented — for write-heavy workloads prefer
`laikacms/assets-r2` or another object-storage backend.
