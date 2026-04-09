# Deployment

> [!TIP]
> Run API and frontend in separate runtimes for security.

## Cloudflare Workers

```typescript
// src/index.ts
import { buildJsonApi } from '@laikacms/storage-api';
import { R2StorageRepository } from '@laikacms/storage-r2';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new R2StorageRepository({ bucket: env.CONTENT_BUCKET });
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
import { buildJsonApi } from '@laikacms/storage-api';
import { FileSystemStorageRepository } from '@laikacms/storage-fs';

const repo = new FileSystemStorageRepository({ basePath: './content' });
const api = buildJsonApi({ repo });

serve({ fetch: api.fetch, port: 3000 });
```

## AWS Lambda

```typescript
import { buildJsonApi } from '@laikacms/storage-api';
import { S3StorageRepository } from '@laikacms/storage-s3';
import { handle } from 'hono/aws-lambda';

const repo = new S3StorageRepository({ bucket: process.env.BUCKET_NAME });
const api = buildJsonApi({ repo });

export const handler = handle(api);
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
