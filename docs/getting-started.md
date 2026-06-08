# Getting Started

## Installation

```bash
pnpm add laikacms
```

## Basic Example

```typescript
import { buildJsonApi } from 'laikacms/storage-api';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { jsonSerializer } from 'laikacms/storage-serializers-json';

const repo = new FileSystemStorageRepository(
  './content', // root directory — created on first write
  { json: jsonSerializer }, // serializer registry: file extension → serializer
  'json', // default extension for new objects
);
const api = buildJsonApi({ repo });

export default { fetch: api.fetch };
```

## Cloudflare Workers

```typescript
import { buildJsonApi } from 'laikacms/storage-api';
import { R2StorageRepository } from 'laikacms/storage-r2';
import { jsonSerializer } from 'laikacms/storage-serializers-json';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new R2StorageRepository(
      env.CONTENT_BUCKET, // R2 bucket binding
      { json: jsonSerializer }, // serializer registry
      'json', // default extension
    );
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
