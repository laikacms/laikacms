# Deployment

> [!TIP]
> Run API and frontend in separate runtimes for security.

## Cloudflare Workers

```typescript
// src/index.ts
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
    const api = buildJsonApi({ repo });
    return api.fetch(request);
  },
};
```

```toml
# wrangler.toml
name = "laika-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[r2_buckets]]
binding = "CONTENT_BUCKET"
bucket_name = "content"
```

Deploy: `wrangler deploy`

## Node.js

```typescript
import { serve } from '@hono/node-server';
import { buildJsonApi } from 'laikacms/storage-api';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { jsonSerializer } from 'laikacms/storage-serializers-json';

const repo = new FileSystemStorageRepository(
  './content', // root directory — created on first write
  { json: jsonSerializer }, // serializer registry: file extension → serializer
  'json', // default extension for new objects
);
const api = buildJsonApi({ repo });

serve({ fetch: api.fetch, port: 3000 });
```

## Environment Variables

| Variable       | Description                       |
| -------------- | --------------------------------- |
| `JWT_SECRET`   | JWT signing secret                |
| `CORS_ORIGINS` | Allowed origins (comma-separated) |
| `LOG_LEVEL`    | Logging level                     |

## Security Checklist

- [ ] HTTPS only
- [ ] CORS configured
- [ ] Rate limiting enabled
- [ ] Authentication required
- [ ] Secrets in environment variables
