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

> **⚠️ No authentication:** `buildJsonApi` ships no authentication — any client can create, read,
> update, and delete content without a token. Do not expose it directly to an untrusted network. For
> a production-ready API with built-in auth, use [`decapApi`](./decap-integration.md) from
> `@laikacms/decap` instead.

> **Note:** `rawSerializer` stores only the `body` field of each content object as plain text.
> Passing any other fields (e.g. `title`, `tags`) will throw an error at write time to prevent
> silent data loss. If you need to persist multi-field content, use `jsonSerializer` instead.

### The `body` convention

Content in laikacms is always an object — you cannot store a raw string directly. When all you have
is a raw string (plain text, markdown, HTML, …), the convention is to wrap it in a `body` field:

```json
{ "body": "<content>" }
```

Markdown with frontmatter follows the same shape — frontmatter fields sit alongside `body`:

```json
{ "title": "Hello", "tags": ["intro"], "body": "# Hello\n\nMy first post." }
```

This is just a convention: the protocol itself never interprets the `content` object. Serializers,
however, build on it — `rawSerializer` persists exactly the `body` field as plain text, and the
markdown serializer writes `body` as the document body with the remaining fields as frontmatter.

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

See [Decap Integration](./decap-integration.md).

## Next Steps

- [Architecture](./architecture.md) - Design patterns
- [API Reference](./api-reference.md) - Endpoints
- [Packages](./packages.md) - All packages
- [Deployment](./deployment.md) - Production setup
