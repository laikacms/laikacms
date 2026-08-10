# Advanced: the raw Storage API

> [!WARNING] **No auth by default.** `buildJsonApi` performs no authentication or authorization
> unless you give it one — any client can create, read, update, and delete content without a token.
> This is the low-level primitive: **you secure it yourself.** Most projects should start with
> [Getting Started](../getting-started) instead, which leads with `laikaApi` (secure by default) and
> only reaches this page for the cases below.

`buildJsonApi` (from `laikacms/storage-api`) wraps any `StorageRepository` in a JSON:API HTTP
handler — the thinnest possible layer between a storage backend and the network. Reach for it
directly when:

- You're building your own auth/routing layer from scratch and don't want the Catalog document/asset
  model that `laikaApi` layers on top.
- You're wiring a non-Decap frontend directly against the Storage JSON:API (see
  [Storage API reference](../../reference/json-api/storage)).
- You're prototyping locally, behind a firewall, with no untrusted network access.

For a Decap CMS admin, prefer `laikaApi` from `@laikacms/server/api` — see
[Getting Started → Server setup](../getting-started#server-setup-recommended-default) and
[Decap Integration](../decap/) — which requires an explicit `authorize` policy and has no insecure
default.

## Minimal example

```typescript
import { allowAll } from 'laikacms/json-api';
import { buildJsonApi } from 'laikacms/storage-api';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { rawSerializer } from 'laikacms/storage-serializers-raw';

const repo = new FileSystemStorageRepository('./content', { md: rawSerializer }, 'md');
const api = buildJsonApi({ repo, authorize: allowAll });

export default { fetch: api.fetch };
```

> [!WARNING] `authorize: allowAll` above means exactly what it says: any client can create, read,
> update, and delete content without a token. It is the explicit opt-out, not a default —
> `buildJsonApi` will not compile without an `authorize` policy. Only keep `allowAll` while this
> handler is unreachable by untrusted callers. Otherwise:
>
> - For a production-ready API with built-in auth, use [`laikaApi`](../decap/) from
>   `@laikacms/server` instead.
> - For custom authorization, pass a real `authorize` callback (below). It runs once per action —
>   receiving the action name, its direct arguments, and the whole `Request` — and returns `true` to
>   allow, `false` to deny with a 403, or a `LaikaError` to deny with a custom status.

## Adding your own `authorize` callback

```typescript
import { AuthenticationError, ForbiddenError } from 'laikacms/core';

const api = buildJsonApi({
  repo,
  authorize: async ({ action, request }) => {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    const user = token ? await lookupUser(token) : undefined;
    if (!user) return new AuthenticationError('Missing or invalid token'); // → 401
    // Reads for everyone, writes for editors only. `readOpenApi` covers the two
    // spec routes, which are authorized like any other action.
    const reads = ['getObject', 'getFolder', 'getAtom', 'getCapabilities', 'readOpenApi'];
    const isWrite = !reads.includes(action) && !action.startsWith('list');
    if (isWrite && !user.canEdit) return new ForbiddenError('Editors only'); // → 403
    return true;
  },
});
```

The same `authorize` option is required on the documents API (`laikacms/documents/api`), the catalog
settings API (`laikacms/catalog-api`), and the assets API (`laikacms/assets-api`). Atomic-operation
requests authorize each sub-action up front, so a single denial rejects the whole batch before any
write runs.

> **Note:** `rawSerializer` stores only the `body` field of each content object as plain text.
> Passing any other fields (e.g. `title`, `tags`) will throw an error at write time to prevent
> silent data loss. If you need to persist multi-field content, use `jsonSerializer` instead.

> Content in laikacms is always an object, not a raw string — the convention is to wrap raw text as
> `{ "body": "..." }`. See
> [Content Model → the `body` convention](../../concepts/content-model#the-body-convention).

## Cloudflare Workers

```typescript
import { buildJsonApi } from 'laikacms/storage-api';
import { R2StorageRepository } from 'laikacms/storage-r2';
import { rawSerializer } from 'laikacms/storage-serializers-raw';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new R2StorageRepository(env.CONTENT_BUCKET, { md: rawSerializer }, 'md');
    return buildJsonApi({ repo, authorize: allowAll }).fetch(request);
  },
};
```

> [!WARNING]
> Same caveat applies — replace `allowAll` with a real `authorize` policy, or put this behind your
> own middleware before deploying.

## Next steps

- [Getting Started](../getting-started) — the recommended, secure-by-default progressive path
- [Decap Integration](../decap/) — `laikaApi`, OAuth2, and the full Decap CMS wiring
- [Storage API reference](../../reference/json-api/storage) — full JSON:API endpoint reference
- [Deployment](../deployment) — production hosting options
