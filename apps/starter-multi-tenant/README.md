# `@laikacms/starter-multi-tenant`

Per-tenant LaikaCMS instances with **isolated content namespaces**. The SaaS-style content platform
pattern: one shared backend serves many orgs, each with their own private content, admin, and
JSON:API surface.

## Stack

- Hono + `@hono/node-server`
- One `createEmbeddedLaika(...)` per tenant, **lazily created and cached** on first access.
- Per-tenant filesystem dirs: `./content/tenants/<tenantId>/`.
- Demo bearer tokens (`acme-token`, `widgetco-token`) map to tenant IDs. Replace with your real auth
  (JWT decode → org ID lookup).

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-multi-tenant dev
```

Then:

```bash
# Acme's posts
curl -H "Authorization: Bearer acme-token" http://localhost:3000/posts
# → { "tenant": "acme", "posts": [{ key: "posts/hello-world", content: {...} }] }

# Widgetco's posts — completely different content
curl -H "Authorization: Bearer widgetco-token" http://localhost:3000/posts

# Without auth: 401 with a helpful hint
curl http://localhost:3000/posts
```

`http://localhost:3000/admin?tenant=acme` opens the Decap admin scoped to Acme. The `?tenant=…`
query is purely so the browser can pick a tenant without setting headers — in production the admin
authenticates with the same Bearer token used by the API.

## Two layouts for tenant storage

### A) Per-tenant FileSystem (this starter)

Simplest. Each tenant gets a directory. Filesystem ACLs and disk quotas work per-tenant.

```
content/
├── tenants/
│   ├── acme/posts/...
│   └── widgetco/posts/...
```

### B) Shared S3 bucket + `keyPrefix` (production)

Single bucket, one `keyPrefix` per tenant. Storage layer enforces isolation; no per-tenant volume
management. Swap `createEmbeddedLaika` for `createCustomLaika` + `laikacms/storage-s3`:

```ts
import { createCustomLaika } from '@laikacms/decap-integrations/custom';
import { R2StorageRepository } from 'laikacms/storage-r2';
import { createS3Bucket } from 'laikacms/storage-s3';

const bucket = createS3Bucket({
  client: s3,
  bucketName: 'multi-tenant',
  commands: {/* ... */},
  keyPrefix: `tenants/${tenantId}/`, // ← isolation
});
const storage = new R2StorageRepository(bucket, serializers, 'md');
const laika = createCustomLaika({ storage, decapConfig, basePath, auth });
```

Same `getTenantLaika(tenantId)` shape as this starter — just the constructor changes.

## Other isolation knobs

- **Subdomain routing.** `tenantFromHost` in `src/tenants.ts` resolves the tenant from
  `acme.example.com`. Wire it into the middleware instead of `tenantFromBearer` if you prefer
  subdomain-based routing.
- **Per-tenant Decap config.** The starter uses one shared `minimalBlogConfig()`. Pass a per-tenant
  `decapConfig` if collections differ across tenants.
- **Resource limits.** Add a per-tenant request count + max content size in the middleware to
  prevent one noisy tenant from starving the others.

## Production hardening

1. **Real auth.** Replace `TOKEN_TO_TENANT` with JWT decode + DB lookup. Reject early if the token's
   tenant ID isn't allowed for the request path.
2. **Connection pooling.** The starter caches one Laika instance per tenant in process memory. For
   many tenants, add a TTL eviction policy.
3. **Per-tenant secrets.** Decap admin's `dev_token` is shared in the demo — give each tenant its
   own admin credentials.
4. **Backup / DR per tenant.** Whether FS or S3, design your backup strategy with per-tenant restore
   in mind.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
