# laikacms

> Modular, runtime-agnostic content management. The basis for modern CMS apps.

API-first headless CMS designed to work with [Decap CMS](https://decapcms.org/) or your own UI. Swap
storage backends (filesystem, R2, GitHub, …) without rewriting code. Runs on Node, Bun, and
Cloudflare Workers.

```bash
pnpm add laikacms
```

## Quick start

### Node / Bun

```ts
import { markdownSerializer } from 'laikacms/serializers/markdown';
import { buildJsonApi } from 'laikacms/storage/api';
import { FileSystemStorageRepository } from 'laikacms/storage/fs';

const repo = new FileSystemStorageRepository('./content', { md: markdownSerializer }, 'md');
const api = buildJsonApi({ repo, authorize: allowAll });

export default { fetch: api.fetch };
```

### Cloudflare Workers

```ts
import { markdownSerializer } from 'laikacms/serializers/markdown';
import { buildJsonApi } from 'laikacms/storage/api';
import { R2StorageRepository } from 'laikacms/storage/r2';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new R2StorageRepository(env.CONTENT_BUCKET, { md: markdownSerializer }, 'md');
    return buildJsonApi({ repo, authorize: allowAll }).fetch(request);
  },
};
```

## What's in the box

`laikacms` is a single package with many focused subpath exports. Import only what you need.

### APIs (JSON:API HTTP layer)

| Export                   | Purpose                            |
| ------------------------ | ---------------------------------- |
| `laikacms/storage/api`   | Storage CRUD over JSON:API         |
| `laikacms/documents/api` | Document/record CRUD over JSON:API |
| `laikacms/assets/api`    | Asset metadata + uploads           |
| `laikacms/catalog-api`   | Catalog settings management        |

### Domain (interfaces & entities)

| Export               | Purpose                         |
| -------------------- | ------------------------------- |
| `laikacms/storage`   | `StorageRepository` interface   |
| `laikacms/documents` | `DocumentsRepository` interface |
| `laikacms/assets`    | `AssetsRepository` interface    |
| `laikacms/catalog`   | `SettingsProvider` interface    |

### Implementations

| Export                             | Backs                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `laikacms/storage/fs`              | Filesystem                                                                                                                                                               |
| `laikacms/storage/r2`              | Cloudflare R2                                                                                                                                                            |
| `laikacms/storage/s3`              | S3→R2Bucket adapter (`createS3Bucket()`) — use with `R2StorageRepository`; **not** a `StorageRepository` itself. Full S3 `StorageRepository`: `@laikacms/aws/storage-s3` |
| `laikacms/storage/webdav`          | WebDAV server                                                                                                                                                            |
| `laikacms/storage/drizzle`         | SQL via Drizzle                                                                                                                                                          |
| `laikacms/storage/jsonapi-proxy`   | Remote JSON:API server                                                                                                                                                   |
| `laikacms/storage/web`             | Web Storage (`localStorage` / `sessionStorage`) — browser / SSR-safe                                                                                                     |
| `laikacms/storage/web-fs`          | Browser File System API (`FileSystemDirectoryHandle`) — local-first, no server required                                                                                  |
| `laikacms/storage-github-cdn`      | Read-only public GitHub repo via jsDelivr CDN — no token, no `@octokit/*` dependency                                                                                     |
| `laikacms/documents/catalog`       | Documents on top of `storage`                                                                                                                                            |
| `laikacms/documents/drizzle`       | Documents in SQL                                                                                                                                                         |
| `laikacms/documents/jsonapi-proxy` | Documents via JSON:API proxy                                                                                                                                             |
| `laikacms/documents/obsidian`      | Obsidian-vault-backed documents                                                                                                                                          |
| `laikacms/assets/catalog`          | Assets on top of `storage`                                                                                                                                               |
| `laikacms/assets/r2`               | Assets in R2                                                                                                                                                             |
| `laikacms/assets/jsonapi-proxy`    | Assets via JSON:API proxy                                                                                                                                                |
| `laikacms/assets/obsidian`         | Obsidian-vault-backed assets — **Node.js / Bun only** (uses `node:fs` / `node:path` / `node:stream`; not available on Cloudflare Workers)                                |
| `laikacms/catalog-convention`      | In-memory / file-backed settings                                                                                                                                         |
| `laikacms/catalog-decap`           | Decap-CMS-compatible settings                                                                                                                                            |

### Testing utilities

| Export                       | Purpose                                                         |
| ---------------------------- | --------------------------------------------------------------- |
| `laikacms/documents/testing` | Contract test harness for `DocumentsRepository` implementations |
| `laikacms/storage/testing`   | Contract test harness for `StorageRepository` implementations   |
| `laikacms/assets/testing`    | Contract test harness for `AssetsRepository` implementations    |

### Serializers

`laikacms/serializers/json` · `…-yaml` · `…-markdown` · `…-raw`

### Shared utilities

`laikacms/core` · `laikacms/crypto` · `laikacms/file-sanitizer` · `laikacms/sanitizer` ·
`laikacms/json-api` · `laikacms/i18n` (`/en`, `/nl`)

## Companion packages

- [`@laikacms/github`](https://www.npmjs.com/package/@laikacms/github) — GitHub-backed storage
  repository
- [`@laikacms/aws`](https://www.npmjs.com/package/@laikacms/aws) — AWS service implementations
  (DynamoDB, S3 `StorageRepository`)
- [`@laikacms/server`](https://www.npmjs.com/package/@laikacms/server) — Decap CMS integrations
  (backend, OAuth2, widgets)
- [`@laikacms/decap-cms`](https://www.npmjs.com/package/@laikacms/decap-cms) — Laika-aware Decap CMS
  fork with AI chat widget (`…/widgets/aichat`), icon widgets, embedded-entry editor, and config
  type utilities (`@laikacms/decap-ai` is discontinued; AI features moved here)

## Documentation

Full docs, architecture notes, and deployment guides live in the
[laikacms repository](https://github.com/laikacms/laikacms).

## Compat helpers — Promise-friendly entry points

`laikacms/compat` exports two Promise-friendly wrappers for non-Effect consumers:

- **`runTask(task, options?)`** — runs a `LaikaTask` and resolves with its value.
- **`collectStream(stream, options?)`** — drains a `LaikaStream` and resolves with
  `{ items, done }`.

Both accept an optional `onProgress` callback that is called for every `LaikaMetadata` event — both
`Progress` and `RecoverableError` — as the task/stream runs.

```ts
import { collectStream, runTask } from 'laikacms/compat';

// Task — receive progress events without importing Effect
const result = await runTask(myTask, {
  onProgress(meta) {
    if (meta._tag === 'Progress') console.log(meta.progress.message);
    if (meta._tag === 'RecoverableError') console.warn(meta.error);
  },
});

// Stream — metadata fires live; data is still collected into items
const { items, done } = await collectStream(myStream, {
  onProgress(meta) {
    if (meta._tag === 'Progress') updateProgressBar(meta.progress);
  },
});
```

Omitting `options` (or `onProgress`) uses a data-only fast path. Note that when `onProgress` is
omitted, **`RecoverableError` and `Progress` events are silently discarded** — callers that need to
surface warnings or non-fatal errors must supply the callback.

`runTask` without `onProgress` drains metadata chunks through the Effect channel (queue allocations
and Effect pulls still occur) but does not allocate metadata arrays or fire any callback.
`collectStream` without `onProgress` performs a data-only drain: no metadata arrays are allocated
and no callback is fired, though channel overhead still applies.

## License

MIT
