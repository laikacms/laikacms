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
import { buildJsonApi } from 'laikacms/storage-api';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';

const repo = new FileSystemStorageRepository({ basePath: './content' });
const api = buildJsonApi({ repo });

export default { fetch: api.fetch };
```

### Cloudflare Workers

```ts
import { buildJsonApi } from 'laikacms/storage-api';
import { R2StorageRepository } from 'laikacms/storage-r2';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new R2StorageRepository({ bucket: env.CONTENT_BUCKET });
    return buildJsonApi({ repo }).fetch(request);
  },
};
```

## What's in the box

`laikacms` is a single package with many focused subpath exports. Import only what you need.

### APIs (JSON:API HTTP layer)

| Export                     | Purpose                            |
| -------------------------- | ---------------------------------- |
| `laikacms/storage-api`     | Storage CRUD over JSON:API         |
| `laikacms/documents-api`   | Document/record CRUD over JSON:API |
| `laikacms/assets-api`      | Asset metadata + uploads           |
| `laikacms/contentbase-api` | Contentbase settings management    |

### Domain (interfaces & entities)

| Export                          | Purpose                         |
| ------------------------------- | ------------------------------- |
| `laikacms/storage`              | `StorageRepository` interface   |
| `laikacms/documents`            | `DocumentsRepository` interface |
| `laikacms/assets`               | `AssetsRepository` interface    |
| `laikacms/contentbase-settings` | `SettingsProvider` interface    |

### Implementations

| Export                                  | Backs                            |
| --------------------------------------- | -------------------------------- |
| `laikacms/storage-fs`                   | Filesystem                       |
| `laikacms/storage-r2`                   | Cloudflare R2                    |
| `laikacms/storage-drizzle`              | SQL via Drizzle                  |
| `laikacms/storage-jsonapi-proxy`        | Remote JSON:API server           |
| `laikacms/documents-contentbase`        | Documents on top of `storage`    |
| `laikacms/documents-drizzle`            | Documents in SQL                 |
| `laikacms/assets-contentbase`           | Assets on top of `storage`       |
| `laikacms/assets-r2`                    | Assets in R2                     |
| `laikacms/contentbase-settings-default` | In-memory / file-backed settings |

### Serializers

`laikacms/storage-serializers-json` · `…-yaml` · `…-markdown` · `…-raw`

### Shared utilities

`laikacms/core` · `laikacms/crypto` · `laikacms/file-sanitizer` · `laikacms/sanitizer` ·
`laikacms/json-api` · `laikacms/i18n` (`/en`, `/nl`)

## Companion packages

- [`@laikacms/github`](https://www.npmjs.com/package/@laikacms/github) — GitHub-backed storage
  repository
- [`@laikacms/aws`](https://www.npmjs.com/package/@laikacms/aws) — AWS service implementations
  (DynamoDB)
- [`@laikacms/decap`](https://www.npmjs.com/package/@laikacms/decap) — Decap CMS integrations
  (backend, OAuth2, widgets, AI chat)

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

Omitting `options` (or `onProgress`) falls through to the fast-path `runPromise` /
`runPromiseCollect` helpers, so there is no overhead when the callback is not needed.

## License

MIT
