# Deployment

> [!TIP]
> Run API and frontend in separate runtimes for security.

## Cloudflare Workers

```typescript
// src/index.ts
import { buildJsonApi } from 'laikacms/storage-api';
import { R2StorageRepository } from 'laikacms/storage-r2';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new R2StorageRepository(env.CONTENT_BUCKET, { md: markdownSerializer }, 'md');
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
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const repo = new FileSystemStorageRepository('./content', { md: markdownSerializer }, 'md');
const api = buildJsonApi({ repo });

serve({ fetch: api.fetch, port: 3000 });
```

## Auth and CORS

`buildJsonApi` has no built-in authentication or CORS handling. Add them as middleware around
`api.fetch` at the framework level.

Example with Hono:

```typescript
import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { cors } from 'hono/cors';
import { buildJsonApi } from 'laikacms/storage-api';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const repo = new FileSystemStorageRepository('./content', { md: markdownSerializer }, 'md');
const api = buildJsonApi({ repo });

const app = new Hono();
app.use('*', cors({ origin: 'https://your-frontend.example.com' }));
app.use('*', bearerAuth({ token: process.env.API_TOKEN! }));
app.all('*', c => api.fetch(c.req.raw));
```

## Logger

Pass a `logger` option to `buildJsonApi` to control log verbosity. Any object implementing
`Pick<Console, 'error' | 'warn' | 'info' | 'debug'>` works:

```typescript
const api = buildJsonApi({ repo, logger: console });
```

Pass a no-op or filtered logger to suppress output:

```typescript
const api = buildJsonApi({
  repo,
  logger: { error: console.error, warn: console.warn, info: () => {}, debug: () => {} },
});
```

## Security Checklist

- [ ] HTTPS only
- [ ] CORS configured at the framework/middleware level (not built in to `buildJsonApi`)
- [ ] Rate limiting enabled
- [ ] Authentication added via middleware (not built in to `buildJsonApi`)
- [ ] Secrets in environment variables
