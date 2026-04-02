# Getting Started

## Installation

```bash
pnpm add @laikacms/core @laikacms/storage @laikacms/storage-api
```

## Basic Example

```typescript
import { buildJsonApi } from '@laikacms/storage-api';
import { FileSystemStorageRepository } from '@laikacms/storage-fs';

const repo = new FileSystemStorageRepository({ basePath: './content' });
const api = buildJsonApi({ repo });

export default { fetch: api.fetch };
```

## Cloudflare Workers

```typescript
import { buildJsonApi } from '@laikacms/storage-api';
import { R2StorageRepository } from '@laikacms/storage-r2';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new R2StorageRepository({ bucket: env.CONTENT_BUCKET });
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
