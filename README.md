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
import { rawSerializer } from 'laikacms/storage-serializers-raw';

const repo = new FileSystemStorageRepository('./content', { md: rawSerializer }, 'md');
const api = buildJsonApi({ repo });

export default { fetch: api.fetch };
```

> **⚠️ No auth** — `buildJsonApi` ships no authentication. See
> [Getting Started](./docs/getting-started.md) for production setup with `decapApi`.

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

## Packages

This repository carries the two core packages. The storage/asset adapters (`@laikacms/aws`,
`@laikacms/github`, …), `laikacli`, `@laikacms/git-gateway`, the `portable-text-*` mappers, and the
example apps were moved out into their own repositories in June 2026 — see
[docs/restructure-2026-06.md](./docs/restructure-2026-06.md).

| Package           | Description                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms`        | Core domain, APIs, default implementations, serializers, shared utilities (subpath exports: `laikacms/storage-api`, `laikacms/storage-fs`, `laikacms/storage-r2`, `laikacms/core`, …) |
| `@laikacms/decap` | Decap CMS integrations: backend, OAuth2, widgets, server adapters.                                                                                                                    |

See [docs/packages.md](./docs/packages.md) for the full list of subpath exports, including the
packages that now live in separate repositories.

## Documentation

- **[LLM-GUIDE.md](./LLM-GUIDE.md) — start here if you're an LLM/agent or want the 5-minute
  version**
- [Getting Started](./docs/getting-started.md)
- [Architecture](./docs/architecture.md)
- [API Reference](./docs/api-reference.md)
- [Decap Integration](./docs/decap-integration.md)
- [Deployment](./docs/deployment.md)
- [Packages](./docs/packages.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Releasing

The two core packages (`laikacms`, `@laikacms/decap`) are released together at the same version
(changesets `fixed` group). Internal `workspace:*` references are pinned to the exact version on
publish. Packages that were moved out of this repo (the adapters, `laikacli`,
`@laikacms/git-gateway`, …) are now released from their own repositories.

```
pnpm changeset
pnpm changeset version
pnpm changeset publish
```

## License

MIT
