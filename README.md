# Laika CMS

<p align="center">
  <strong>Modular, runtime-agnostic content management software</strong>
</p>

<p align="center">
  <a href="https://github.com/laikacms/laikacms/blob/develop/LICENSE"><img src="https://img.shields.io/github/license/laikacms/laikacms" alt="License"></a>
  <a href="https://github.com/laikacms/laikacms/pulse"><img src="https://img.shields.io/github/commit-activity/m/laikacms/laikacms/develop" alt="Commit Activity"></a>
  <a href="https://github.com/laikacms/laikacms/commits/develop"><img src="https://img.shields.io/github/last-commit/laikacms/laikacms/develop" alt="Last Commit"></a>
</p>
<p align="center">
  <img src="https://img.shields.io/badge/node-22.x-brightgreen" alt="Node.js">
  <img src="https://img.shields.io/badge/pnpm-10.4.1-orange" alt="pnpm">
  <a href="https://github.com/laikacms/laikacms/network/dependencies"><img src="https://img.shields.io/librariesio/github/laikacms/laikacms" alt="Dependencies"></a>
</p>

---

API-first CMS designed to work with [Decap CMS](https://decapcms.org/) or your own UI. Swap storage
backends without rewriting code.

## Quick Start

```bash
pnpm add laikacms
```

```typescript
import { buildJsonApi } from 'laikacms/storage-api';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';

const repo = new FileSystemStorageRepository({ basePath: './content' });
const api = buildJsonApi({ repo });

export default { fetch: api.fetch };
```

## Cloudflare Workers

```typescript
import { buildJsonApi } from 'laikacms/storage-api';
import { R2StorageRepository } from 'laikacms/storage-r2';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new R2StorageRepository({ bucket: env.CONTENT_BUCKET });
    return buildJsonApi({ repo }).fetch(request);
  },
};
```

## Packages

| Package                 | Description                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms`              | Core domain, APIs, default implementations, serializers, shared utilities (subpath exports: `laikacms/storage-api`, `laikacms/storage-fs`, `laikacms/storage-r2`, `laikacms/core`, …) |
| `@laikacms/aws`         | AWS service implementations (DynamoDB-backed contentbase settings)                                                                                                                    |
| `@laikacms/decap`       | Decap CMS integrations: backend, OAuth2, widgets, AI chat                                                                                                                             |
| `@laikacms/git-gateway` | Drop-in Netlify git-gateway-compatible HTTP handler (Decap `backend: git-gateway`)                                                                                                    |
| `@laikacms/github`      | GitHub-backed `StorageRepository` (GitHub App auth)                                                                                                                                   |

See [docs/packages.md](./docs/packages.md) for the full list of subpath exports.

## Apps

| App             | Description                                                                                                                                                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laika-gateway` | Hosted multi-tenant Cloudflare Worker. One GitHub App; users install it on their own repo and point Decap CMS at this gateway instead of standing up their own Worker. URL scheme is namespaced (`/github/...`) so other source backends can be added later. See [apps/laika-gateway/README.md](./apps/laika-gateway/README.md). |

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Architecture](./docs/architecture.md)
- [API Reference](./docs/api-reference.md)
- [Decap Integration](./docs/decap-integration.md)
- [Deployment](./docs/deployment.md)
- [Packages](./docs/packages.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Releasing

All public packages (`laikacms`, `@laikacms/aws`, `@laikacms/decap`, `@laikacms/github`) are
released together at the same version (changesets `fixed` group). Internal `workspace:*` references
are pinned to the exact version on publish. `@laikacms/dynamodb-local` is `private` and never
published — its version stays in lockstep with the rest but is not pushed to npm.

```
pnpm changeset
pnpm changeset version
pnpm changeset publish
```

## License

MIT
