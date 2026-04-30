# Laika CMS

<p align="center">
  <strong>Modular, runtime-agnostic content management software</strong>
</p>

<p align="center">
  <a href="https://github.com/laikacms/laikacms/blob/main/LICENSE"><img src="https://img.shields.io/github/license/laikacms/laikacms" alt="License"></a>
  <a href="https://github.com/laikacms/laikacms/pulse"><img src="https://img.shields.io/github/commit-activity/m/laikacms/laikacms" alt="Commit Activity"></a>
  <a href="https://github.com/laikacms/laikacms/commits/main"><img src="https://img.shields.io/github/last-commit/laikacms/laikacms" alt="Last Commit"></a>
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
pnpm add @laikacms/core @laikacms/storage @laikacms/storage-api
```

```typescript
import { buildJsonApi } from '@laikacms/storage-api';
import { FileSystemStorageRepository } from '@laikacms/storage-fs';

const repo = new FileSystemStorageRepository({ basePath: './content' });
const api = buildJsonApi({ repo });

export default { fetch: api.fetch };
```

## Cloudflare Workers

```typescript
import { buildJsonApi } from '@laikacms/storage-api';
import { R2StorageRepository } from '@laikacms/storage-r2';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new R2StorageRepository({ bucket: env.CONTENT_BUCKET });
    return buildJsonApi({ repo }).fetch(request);
  },
};
```

## Packages

| Layer          | Packages                                                                      |
| -------------- | ----------------------------------------------------------------------------- |
| Domain         | `@laikacms/storage`, `@laikacms/documents`, `@laikacms/assets`                |
| API            | `@laikacms/storage-api`, `@laikacms/documents-api`, `@laikacms/assets-api`    |
| Implementation | `@laikacms/storage-r2`, `@laikacms/storage-fs`, `@laikacms/documents-drizzle` |
| Shared         | `@laikacms/core`, `@laikacms/crypto`, `@laikacms/json-api`                    |
| Decap          | `@laikacms/decap-cms-backend-laika`, `@laikacms/decap-oauth2`                 |

See [docs/packages.md](./docs/packages.md) for full list.

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

```
pnpm changeset
pnpm changeset version
pnpm changeset publish
```

## License

MIT
