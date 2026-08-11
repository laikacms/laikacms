# Obsidian

The Obsidian implementations turn a vault into a LaikaCMS content source: your notes stay ordinary
Obsidian notes, and LaikaCMS reads and writes them through the [Documents](../concepts/documents)
and [Assets](../concepts/assets) protocols.

- **`documents-obsidian`** — each markdown note is a document keyed by its vault-relative path.
  Published state comes from frontmatter (the `publish` property, matching the Obsidian Publish
  convention), not from separate directories.
- **`assets-obsidian`** — vault attachments as an `AssetsRepository`.

## Wire it up

```ts
import { ObsidianAssetsRepository } from 'laikacms/assets-obsidian';
import { ObsidianDocumentsRepository } from 'laikacms/documents-obsidian';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const storage = new FileSystemStorageRepository('/path/to/vault', { md: markdownSerializer }, 'md');

const documents = new ObsidianDocumentsRepository(storage);
const assets = new ObsidianAssetsRepository('/path/to/vault', {
  attachmentsDirectory: 'attachments',
});
```

Frontmatter conventions are configurable — `publishProperty`, `statusProperty`, and `defaultStatus`
on the documents side; `attachmentsDirectory`, `documentExtensions`, `ignore`, and `createUrl` on
the assets side.

## Capability notes

- **Node.js / Bun only** — the assets repository uses `node:fs`/`node:stream`; there is no edge
  build. Sync the vault to a server (Obsidian Sync, git, Syncthing) or serve it through the
  [JSON:API proxy](./jsonapi-proxy).
- The documents repository is storage-agnostic — point the underlying storage at anything that holds
  the vault's markdown, not just the local filesystem.
- Full option tables:
  [`documents-obsidian`](https://github.com/laikacms/laikacms/blob/develop/packages/laikacms/src/impl/documents-obsidian/README.md)
  and
  [`assets-obsidian`](https://github.com/laikacms/laikacms/blob/develop/packages/laikacms/src/impl/assets-obsidian/README.md)
  READMEs.
