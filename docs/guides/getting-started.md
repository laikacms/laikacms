# Getting Started

## Installation

```bash
pnpm add laikacms
```

## Basic Example

```typescript
import { buildJsonApi } from 'laikacms/storage-api';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { rawSerializer } from 'laikacms/storage-serializers-raw';

const repo = new FileSystemStorageRepository('./content', { md: rawSerializer }, 'md');
const api = buildJsonApi({ repo });

export default { fetch: api.fetch };
```

> **⚠️ No authentication by default:** `buildJsonApi` performs no authentication unless you give it
> one — any client can create, read, update, and delete content without a token. Do not expose it
> directly to an untrusted network. You have two options:
>
> - For a production-ready API with built-in auth, use [`decapApi`](./decap/) from `@laikacms/decap`
>   instead.
> - For custom authorization, pass an `authorize` callback (see below). It runs once per action —
>   receiving the action name, its direct arguments, and the whole `Request` — and returns `true` to
>   allow, `false` to deny with a 403, or a `LaikaError` to deny with a custom status.
>
> ```typescript
> import { AuthenticationError, ForbiddenError } from 'laikacms/core';
>
> const api = buildJsonApi({
>   repo,
>   authorize: async ({ action, request }) => {
>     const token = request.headers.get('Authorization')?.replace('Bearer ', '');
>     const user = token ? await lookupUser(token) : undefined;
>     if (!user) return new AuthenticationError('Missing or invalid token'); // → 401
>     // Reads for everyone, writes for editors only.
>     const isWrite = action !== 'getObject' && action !== 'getFolder' && !action.startsWith('list');
>     if (isWrite && !user.canEdit) return new ForbiddenError('Editors only'); // → 403
>     return true;
>   },
> });
> ```
>
> The same `authorize` option is available on the documents API (`laikacms/documents/api`) and the
> contentbase settings API (`laikacms/contentbase-api`). Atomic-operation requests authorize each
> sub-action up front, so a single denial rejects the whole batch before any write runs.

> **Note:** `rawSerializer` stores only the `body` field of each content object as plain text.
> Passing any other fields (e.g. `title`, `tags`) will throw an error at write time to prevent
> silent data loss. If you need to persist multi-field content, use `jsonSerializer` instead.

> Content in laikacms is always an object, not a raw string — the convention is to wrap raw text as
> `{ "body": "..." }`. See
> [Content Model → the `body` convention](../concepts/content-model#the-body-convention).

## Cloudflare Workers

```typescript
import { buildJsonApi } from 'laikacms/storage-api';
import { R2StorageRepository } from 'laikacms/storage-r2';
import { rawSerializer } from 'laikacms/storage-serializers-raw';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new R2StorageRepository(env.CONTENT_BUCKET, { md: rawSerializer }, 'md');
    return buildJsonApi({ repo }).fetch(request);
  },
};
```

## With Decap CMS

See [Decap Integration](./decap/).

## Next Steps

- [Architecture](../concepts/architecture) - Design patterns
- [JSON:API Reference](../reference/json-api/) - Endpoints
- [Packages](../reference/packages) - All packages
- [Deployment](./deployment) - Production setup
