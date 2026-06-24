# `laikacms/documents-obsidian`

A `DocumentsRepository` implementation backed by an [Obsidian](https://obsidian.md/) vault. Each
markdown note is a document keyed by its vault-relative path; published vs. unpublished state is
read from frontmatter (the `publish` property, matching the Obsidian Publish convention) rather than
from separate directories.

Pair it with a `StorageRepository` pointed at the vault root — typically a
`FileSystemStorageRepository` configured with the markdown serializer.

## Usage

```ts
import { ObsidianDocumentsRepository } from 'laikacms/documents-obsidian';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const storage = new FileSystemStorageRepository(
  '/path/to/vault',
  { md: markdownSerializer },
  'md',
);

const repo = new ObsidianDocumentsRepository(storage);
```

### Custom frontmatter properties

```ts
const repo = new ObsidianDocumentsRepository(storage, {
  publishProperty: 'published', // read/write 'published' instead of 'publish'
  statusProperty: 'stage', // read/write 'stage' instead of 'status'
  defaultStatus: 'idea', // status when 'stage' is absent; default 'draft'
});
```

## Constructor

```ts
new ObsidianDocumentsRepository(
  storageRepository: StorageRepository,
  options?: ObsidianDocumentsRepositoryOptions,
)
```

| Parameter           | Type                                 | Description                                                                       |
| ------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| `storageRepository` | `StorageRepository`                  | Underlying storage, typically `FileSystemStorageRepository + markdownSerializer`. |
| `options`           | `ObsidianDocumentsRepositoryOptions` | Optional. See table below.                                                        |

## Options

| Option            | Type     | Default     | Description                                                                                                                                                          |
| ----------------- | -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publishProperty` | `string` | `'publish'` | Frontmatter property that marks a note as published. A note is a published `Document` when this property is strictly `true`; otherwise it is an `Unpublished` draft. |
| `statusProperty`  | `string` | `'status'`  | Frontmatter property that records the editorial status of a draft (`draft`, `pending_review`, …).                                                                    |
| `defaultStatus`   | `string` | `'draft'`   | Status reported for a draft note that has no explicit `statusProperty` value.                                                                                        |

## Frontmatter conventions

### Published note

```yaml
---
publish: true
language: en
title: My Note
---
```

- `publish: true` — required; anything other than strict `true` is treated as unpublished. Also
  preserved in the document's `content`.
- `language` — optional BCP 47 tag (e.g. `en`, `nl`). Omitted or empty resolves to `'und'`
  (undetermined). Also preserved in the document's `content`.
- All other frontmatter keys (including `publish` and `language` above) are passed through as
  document `content`.

### Draft / unpublished note

```yaml
---
publish: false
status: pending_review
language: en
title: My Draft
---
```

- `publish: false` (or absent / any non-`true` value) — note is an `Unpublished` draft. Also
  preserved in the document's `content`.
- `status` — editorial state. Common values: `draft`, `pending_review`, `published` (though
  `published` is normally expressed via `publish: true`). Missing value falls back to
  `defaultStatus`. Also preserved in the document's `content`.
- `language` — optional BCP 47 tag. Also preserved in the document's `content`.

When a note is published via `publish()` the `publish` property is set to `true` and the `status`
property is removed. When it is unpublished via `unpublish()` the reverse happens. Note that
`publish`, `language`, and `status` are accessible both as top-level `Document` fields and within
the `content` object.

## Behaviour notes

- **Keys.** A document's key is its vault-relative path without the file extension (e.g.
  `blog/2024-hello-world`). Keys are case-sensitive and use `/` as the path separator regardless of
  OS.
- **Listing reads full objects.** Because published state is stored in frontmatter, `listRecords`
  and `listRecordSummaries` must read full file content — unlike storage implementations that use
  separate directories, `listAtomSummaries` alone cannot distinguish published notes from drafts.
- **Language.** A note without a `language` frontmatter key is returned with `language: 'und'`.
  Setting `language` to `'und'` on create/update removes the key from the frontmatter.
- **Capabilities.** Pagination capabilities are delegated to the underlying `StorageRepository`.

## Limitations

Obsidian is a local markdown editor with no built-in version history. The revision API surface is
therefore unsupported:

| Method           | Behaviour                                   |
| ---------------- | ------------------------------------------- |
| `getRevision`    | Always throws `BadRequestError`             |
| `createRevision` | Always throws `BadRequestError`             |
| `listRevisions`  | Always returns an empty stream (`total: 0`) |

No built-in `DocumentsRepository` with revision history exists yet. If you need file-level history,
pair a `DocumentsRepository` that delegates to a storage backend with change tracking — for example
`GithubStorageRepository` from `@laikacms/github` (a `StorageRepository`) preserves each write as a
GitHub commit, giving you a per-file audit trail at the storage layer.
