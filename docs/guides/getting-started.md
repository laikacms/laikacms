# Getting Started

## Installation

```bash
pnpm add laikacms
```

## Basic Example

```typescript
import { buildJsonApi } from 'laikacms/storage-api';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { rawSerializer } from 'laikacms/storage-serializers-raw';

const repo = new FileSystemStorageRepository('./content', { md: rawSerializer }, 'md');
const api = buildJsonApi({ repo });

export default { fetch: api.fetch };
```

> **⚠️ No authentication:** `buildJsonApi` ships no authentication — any client can create, read,
> update, and delete content without a token. Do not expose it directly to an untrusted network. For
> a production-ready API with built-in auth, use [`decapApi`](./decap/) from `@laikacms/decap`
> instead.

> **Note:** `rawSerializer` stores only the `body` field of each content object as plain text.
> Passing any other fields (e.g. `title`, `tags`) will throw an error at write time to prevent
> silent data loss. If you need to persist multi-field content, use `jsonSerializer` instead.

> Content in laikacms is always an object, not a raw string — the convention is to wrap raw text as
> `{ "body": "..." }`. See
> [Content Model → the `body` convention](../concepts/content-model#the-body-convention).

## Cloudflare Workers

```typescript
import { buildJsonApi } from 'laikacms/storage-api';
import { R2StorageRepository } from 'laikacms/storage-r2';
import { rawSerializer } from 'laikacms/storage-serializers-raw';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new R2StorageRepository(env.CONTENT_BUCKET, { md: rawSerializer }, 'md');
    return buildJsonApi({ repo }).fetch(request);
  },
};
```

## With Decap CMS

See [Decap Integration](./decap/).

## Next Steps

- [Architecture](../concepts/architecture) - Design patterns
- [JSON:API Reference](../reference/json-api/) - Endpoints
- [Packages](../reference/packages) - All packages
- [Deployment](./deployment) - Production setup
