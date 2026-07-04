# Getting Started

## Installation

```bash
pnpm add laikacms
```

## Basic Example

```typescript
import { rawSerializer } from 'laikacms/serializers/raw';
import { buildJsonApi } from 'laikacms/storage/api';
import { FileSystemStorageRepository } from 'laikacms/storage/fs';

const repo = new FileSystemStorageRepository('./content', { md: rawSerializer }, 'md');
const api = buildJsonApi({ repo });

export default { fetch: api.fetch };
```

> **Note:** `rawSerializer` stores only the `body` field of each content object as plain text.
> Passing any other fields (e.g. `title`, `tags`) will throw an error at write time to prevent
> silent data loss. If you need to persist multi-field content, use `jsonSerializer` instead.

## Cloudflare Workers

```typescript
import { rawSerializer } from 'laikacms/serializers/raw';
import { buildJsonApi } from 'laikacms/storage/api';
import { R2StorageRepository } from 'laikacms/storage/r2';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new R2StorageRepository(env.CONTENT_BUCKET, { md: rawSerializer }, 'md');
    return buildJsonApi({ repo }).fetch(request);
  },
};
```

## With Decap CMS

See [Decap Integration](./decap-integration.md).

## Next Steps

- [Architecture](./architecture.md) - Design patterns
- [API Reference](./api-reference.md) - Endpoints
- [Packages](./packages.md) - All packages
- [Deployment](./deployment.md) - Production setup
