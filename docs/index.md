---
layout: home

hero:
  name: Laika CMS
  text: Composable, runtime-agnostic content management.
  tagline: Modular packages for storage, documents, and assets — bring your own UI, run anywhere JavaScript runs.
  actions:
    - theme: brand
      text: Get Started
      link: /guides/getting-started
    - theme: alt
      text: Concepts
      link: /concepts/
    - theme: alt
      text: View on GitHub
      link: https://github.com/laikacms/laikacms

features:
  - title: Modular by Design
    details: Pick only the packages you need — storage, documents, assets, auth, crypto, sanitizer, i18n.
  - title: Runtime Agnostic
    details: Works on Node.js, Cloudflare Workers, AWS Lambda, Deno, and anywhere modern JavaScript runs.
  - title: Minimal Dependencies
    details: Extremely slim bundles so your edge and serverless deployments stay fast.
  - title: Standard Schema Compatible
    details: Use Zod, Valibot, ArkType, or any Standard Schema validator interchangeably.
  - title: Security First
    details: Quantum-safe cryptography, file sanitization, and built-in defaults to harden production.
  - title: API-First
    details: JSON:API endpoints out of the box — pair with Decap CMS or any frontend you already use.
---

## Quick Links

**Guides**

- [Getting Started](./guides/getting-started) — Installation and basic usage
- [Decap CMS Integration](./guides/decap/) — Using Decap CMS as a frontend
- [Deployment](./guides/deployment) — Production deployment guides
- [Security](./guides/security) — Security best practices

**Concepts**

- [Architecture](./concepts/architecture) — How Laika CMS is structured
- [Repositories](./concepts/repositories) — The repository pattern and its implementations
- [Content Model](./concepts/content-model) — Atoms, folders, the `body` convention, change tracking

**Reference**

- [JSON:API Reference](./reference/json-api/) — Complete API documentation
- [Packages](./reference/packages) — Overview of all packages
- [Glossary](./reference/glossary) — Shared vocabulary (protocol, repository, adapter, version, sync
  token, change feed)

**Contributing**

- [Contributing](./contributing/) — starter templates and the contribution workflow

## Architecture Overview

```mermaid
flowchart TD
  api["API Layer<br/><small>storage-api, documents-api, assets-api, contentbase-api</small>"]
  domain["Domain Layer<br/><small>storage, documents, assets, contentbase-settings</small>"]
  implementation["Implementation Layer<br/><small>storage-r2, storage-fs, documents-drizzle, assets-r2</small>"]
  shared["Shared Layer<br/><small>core, auth, crypto, sanitizer, i18n, json-api</small>"]

  api --> domain --> implementation --> shared
```

## Getting Help

- **GitHub Issues** — For bugs and feature requests
- **GitHub Discussions** — For questions and discussions
- **Contributing** — See
  [CONTRIBUTING.md](https://github.com/laikacms/laikacms/blob/develop/CONTRIBUTING.md)

## License

Laika CMS is [MIT licensed](https://github.com/laikacms/laikacms/blob/develop/LICENSE).
