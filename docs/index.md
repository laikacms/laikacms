---
layout: home

hero:
  name: Laika CMS
  text: Composable, runtime-agnostic content management.
  tagline: Modular packages for storage, documents, and assets — bring your own UI, run anywhere JavaScript runs.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: Architecture
      link: /architecture
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

- [Getting Started](./getting-started.md) — Installation and basic usage
- [Starter templates](./starters.md) — Reference apps for each frontend framework
- [Architecture](./architecture.md) — How Laika CMS is structured
- [API Reference](./api-reference.md) — Complete API documentation
- [Packages](./packages.md) — Overview of all packages
- [Decap CMS Integration](./decap-integration.md) — Using Decap CMS as a frontend
- [Deployment](./deployment.md) — Production deployment guides
- [Security](./SECURITY.md) — Security best practices
- [Test Strategy](./test-strategy.md) — Coverage gaps and rollout plan

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        API Layer                             │
│  (storage-api, documents-api, assets-api, contentbase-api)  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Domain Layer                            │
│        (storage, documents, assets, contentbase-settings)   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Implementation Layer                        │
│   (storage-r2, storage-fs, documents-drizzle, assets-r2)    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Shared Layer                             │
│        (core, auth, crypto, sanitizer, i18n, json-api)      │
└─────────────────────────────────────────────────────────────┘
```

## Getting Help

- **GitHub Issues** — For bugs and feature requests
- **GitHub Discussions** — For questions and discussions
- **Contributing** — See
  [CONTRIBUTING.md](https://github.com/laikacms/laikacms/blob/develop/CONTRIBUTING.md)

## License

Laika CMS is [MIT licensed](https://github.com/laikacms/laikacms/blob/develop/LICENSE).
