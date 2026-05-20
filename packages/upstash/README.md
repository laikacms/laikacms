# `@laikacms/upstash`

[Upstash](https://upstash.com) service implementations for Laika CMS. Designed for edge deployments — every subpath export depends only on `fetch`, so the whole package runs on Node, Bun, Deno, Cloudflare Workers, Vercel Edge, and the browser.

## `@laikacms/upstash/storage-redis`

A `StorageRepository` backed by Redis via the [Upstash Redis REST API](https://upstash.com/docs/redis/features/restapi). Useful when:

- you're deploying on the edge and can't open a TCP connection to a Redis server
- you want a low-latency cache-tier `StorageRepository` to put in front of S3/DDB/etc.
- you want a tiny standalone storage for a side-project that doesn't justify a full DB

```ts
import { UpstashRedisStorageRepository } from '@laikacms/upstash/storage-redis';
import { storageSerializerJson } from 'laikacms/storage-serializers-json';

const repo = new UpstashRedisStorageRepository({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  namespace: 'site-a:storage',       // optional — defaults to "laika:storage"
  serializerRegistry: { json: storageSerializerJson },
  defaultFileExtension: 'json',
});
```

### Key layout

```
<namespace>:file:<path>.<ext>      Redis string holding the serialized content
<namespace>:folder:<path>          empty marker so empty folders surface in listings
```

Listing a folder uses `SCAN MATCH <namespace>:{file,folder}:<folder>/*` twice (once for each kind) and groups results client-side by their next path segment, so both direct files and direct sub-folders surface correctly. Finding an extension-free key pipelines one `EXISTS` per registered serializer extension in a single round-trip — the round-trip count for any single read is fixed regardless of how many serializers you've registered.

### Multi-tenant

Pass `namespace` per tenant. The repository never touches keys outside its namespace prefix.

### Trade-offs

- **String values, not JSON.** Redis values are strings; the repository serializes via the standard serializer registry, same as every other `StorageRepository`. Use the `json` serializer if you want JSON-encoded payloads.
- **`SCAN` is best-effort.** Redis guarantees every key that survives the whole scan is returned at least once, but may return duplicates if keys are modified mid-scan. The repository deduplicates client-side.
- **No TTL / expiration.** Objects don't expire — this is storage, not a cache. Configure Redis-level eviction (`allkeys-lru` etc.) if you want bounded memory.
- **`revisionId` is not exposed.** Redis has no per-key version counter; if you need optimistic concurrency, layer a separate `WATCH`/`MULTI`/`EXEC` pattern at the application level.
- **Pagination.** Cursor pagination is not exposed; `offset`/`page` styles are applied in memory after a natural-order sort.

### Errors

- 401 → `AuthenticationError`
- 403 → `ForbiddenError`
- 429 → `TooManyRequestsError`
- 5xx → `ServiceUnavailableError`
- Other non-2xx → `InternalError` with the upstream message preserved

The data source also surfaces Upstash's `{ error }` envelope as an `InternalError` so command-level Redis errors don't get silently dropped.
