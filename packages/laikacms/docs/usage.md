---
title: Usage
order: 1
---

# Usage

Back to [`laikacms` overview](./index.md).

## Node / Bun

```ts
import { markdownSerializer } from 'laikacms/serializers/markdown';
import { buildJsonApi } from 'laikacms/storage/api';
import { FileSystemStorageRepository } from 'laikacms/storage/fs';

const repo = new FileSystemStorageRepository('./content', { md: markdownSerializer }, 'md');
const api = buildJsonApi({ repo, authorize: allowAll });

export default { fetch: api.fetch };
```

## Cloudflare Workers

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

## Compat helpers — Promise-friendly entry points

`laikacms/compat` exports two Promise-friendly wrappers for non-Effect consumers:

- **`runTask(task, options?)`** — runs a `LaikaTask` and resolves with its value.
- **`collectStream(stream, options?)`** — drains a `LaikaStream` and resolves with
  `{ items, done }`.

Both accept an optional `onProgress` callback fired for every `LaikaMetadata` event — both
`Progress` and `RecoverableError` — as the task/stream runs. Omitting `onProgress` uses a data-only
fast path and **silently discards** those events; callers that need to surface warnings must supply
the callback.

```ts
import { collectStream, runTask } from 'laikacms/compat';

const result = await runTask(myTask, {
  onProgress(meta) {
    if (meta._tag === 'Progress') console.log(meta.progress.message);
    if (meta._tag === 'RecoverableError') console.warn(meta.error);
  },
});
```
