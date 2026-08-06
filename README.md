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
  <img src="https://img.shields.io/badge/node-24.x-brightgreen" alt="Node.js">
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

> **⚠️ No auth by default** — `buildJsonApi` performs no authentication unless you give it one. Pass
> an `authorize` callback (invoked per action with its args + the `Request`, returning
> `true`/`false`/a `LaikaError`), or use `decapApi` for built-in auth. See
> [Getting Started](./docs/guides/getting-started.md) for both.

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
[Packages](./docs/reference/packages.md) for their current locations.

| Package           | Description                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms`        | Core domain, APIs, default implementations, serializers, shared utilities (subpath exports: `laikacms/storage-api`, `laikacms/storage-fs`, `laikacms/storage-r2`, `laikacms/core`, …) |
| `@laikacms/decap` | Decap CMS integrations: backend, OAuth2, widgets, server adapters.                                                                                                                    |

See [docs/reference/packages.md](./docs/reference/packages.md) for the full list of subpath exports,
including the packages that now live in separate repositories.

## Documentation

- **[LLM-GUIDE.md](./LLM-GUIDE.md) — start here if you're an LLM/agent or want the 5-minute
  version**
- [Getting Started](./docs/guides/getting-started.md)
- [Architecture](./docs/concepts/architecture.md)
- [API Reference](./docs/reference/json-api/index.md)
- [Decap Integration](./docs/guides/decap/index.md)
- [Deployment](./docs/guides/deployment.md)
- [Packages](./docs/reference/packages.md)

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

## History

Laika CMS predates LLMs. I started it in 2016 with the schema-to-form generator I used for client
CMS systems. Once I could model a client's content schema with a higher-order schema, I had a
content-model editor—a Turing-complete schema-to-form generator, if you will. That started the
rabbit hole toward a perfectly loosely coupled CMS.

I came close to releasing it roughly eight years ago, during the JAMstack era. The scale and
maintenance of the monorepo caught up with me, together with the technical debt from all my earlier
mistakes and bad assumptions. Trimming it further would have destroyed the mechanics that made it
worth using.

### Claude

Without a team or a big budget, I could not have turned these ideas into a useful library. Claude
made that possible. It allowed me to build a large project from one mental model instead of
splitting it across a team, which I believe has led to an amazing result. Some parts of Laika CMS
may look strange at first. They have been designed, created, discarded, and rebuilt repeatedly until
the core became truly headless, backend-agnostic, and modular.

Claude made it possible to revive the project and fix the assumptions that stopped the earlier
version from shipping.

This matters more now than it did then, and it is becoming more relevant. Writing code is cheaper,
and LLMs need homogeneous access to information from different sources. Laika CMS is more than a CMS
core: it is a protocol for making content from those sources addressable through one surface.

If you do not trust AI-assisted code, don't use Laika CMS for now. I am choosing highly creative and
fast growth over stability at this stage. Stability will come from production use, open-source
contributions, sponsorship, and the commercial success of projects using Laika CMS.

Read the [roadmap](./ROADMAP.md), [security policy](./SECURITY.md),
[changelog](./docs/CHANGELOG.md), and [contribution guide](./CONTRIBUTING.md) before adopting it.

## License

MIT
