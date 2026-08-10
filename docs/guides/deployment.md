# Deployment

> [!TIP]
> Run API and frontend in separate runtimes for security.

## Cloudflare Workers

```typescript
// src/index.ts
import { allowAll } from 'laikacms/json-api';
import { buildJsonApi } from 'laikacms/storage-api';
import { R2StorageRepository } from 'laikacms/storage-r2';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new R2StorageRepository(env.CONTENT_BUCKET, { md: markdownSerializer }, 'md');
    const api = buildJsonApi({ repo, authorize: allowAll });
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

> **⚠️ `allowAll` means allow all:** the samples above opt out of access control explicitly — any
> client can create, read, update, and delete content without a token. `buildJsonApi` requires an
> `authorize` policy precisely so this is a decision you typed, not a default you inherited. Replace
> it with a real policy, wrap the handler in the middleware shown below, or — for a production-ready
> API with built-in auth — use [`laikaApi`](./decap/) from `@laikacms/server` instead.

## Node.js

```typescript
import { serve } from '@hono/node-server';
import { buildJsonApi } from 'laikacms/storage-api';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const repo = new FileSystemStorageRepository('./content', { md: markdownSerializer }, 'md');
const api = buildJsonApi({ repo, authorize: allowAll });

serve({ fetch: api.fetch, port: 3000 });
```

> **⚠️ No authentication:** `buildJsonApi` ships no authentication — any client can create, read,
> update, and delete content without a token. Do not expose it directly to an untrusted network. For
> a production-ready API with built-in auth, use [`laikaApi`](./decap/) from `@laikacms/server`
> instead.

## Auth and CORS

`buildJsonApi` authorizes each action via the required `authorize` callback, but it does not
_authenticate_ callers and has no CORS handling. Either validate the credential inside `authorize`,
or add both as middleware around `api.fetch` at the framework level — in which case the handler's
own policy can stay `allowAll`, since the middleware is the gate.

**Cloudflare Workers** — check the `Authorization` header directly in the `fetch` handler:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (token !== env.API_TOKEN) {
      return new Response('Unauthorized', { status: 401 });
    }
    const repo = new R2StorageRepository(env.CONTENT_BUCKET, { md: markdownSerializer }, 'md');
    // The token check above is the gate, so the handler itself allows all.
    const api = buildJsonApi({ repo, authorize: allowAll });
    return api.fetch(request);
  },
};
```

**Node.js / Hono:**

```typescript
import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { cors } from 'hono/cors';
import { allowAll } from 'laikacms/json-api';
import { buildJsonApi } from 'laikacms/storage-api';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const repo = new FileSystemStorageRepository('./content', { md: markdownSerializer }, 'md');
// `bearerAuth` below is the gate, so the handler itself allows all.
const api = buildJsonApi({ repo, authorize: allowAll });

const app = new Hono();
app.use('*', cors({ origin: 'https://your-frontend.example.com' }));
app.use('*', bearerAuth({ token: process.env.API_TOKEN! }));
app.all('*', c => api.fetch(c.req.raw));
```

## Logger

Pass a `logger` option to `buildJsonApi` to control log verbosity. Any object implementing
`Pick<Console, 'error' | 'warn' | 'info' | 'debug'>` works:

```typescript
const api = buildJsonApi({ repo, authorize: allowAll, logger: console });
```

Pass a no-op or filtered logger to suppress output:

```typescript
const api = buildJsonApi({
  repo,
  authorize: allowAll,
  logger: { error: console.error, warn: console.warn, info: () => {}, debug: () => {} },
});
```

## Security Checklist

- [ ] HTTPS only
- [ ] CORS configured at the framework/middleware level (not built in to `buildJsonApi`)
- [ ] Rate limiting enabled
- [ ] Authentication added via middleware (not built in to `buildJsonApi`)
- [ ] Secrets in environment variables
