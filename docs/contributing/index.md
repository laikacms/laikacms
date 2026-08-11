# Contributing

Notes for people working _on_ LaikaCMS rather than _with_ it. If you're building an app that uses
LaikaCMS, see the [quickstarts](../getting-started/vite) instead — this section is for changes to
this repo.

## Orientation

LaikaCMS is a monorepo carrying **two core packages**, released together:

| Package            | What it is                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `laikacms`         | Core domain, HTTP APIs, storage/document/asset implementations, serializers, shared utilities. |
| `@laikacms/server` | Decap CMS integrations: the Decap-compatible backend, OAuth2, widgets, server adapters.        |

Alongside them, `packages/github`, `packages/gitlab`, `packages/bitbucket`, and
`packages/vite-plugin` hold git-host storage adapters and the dev-server plugin. `docs/` and
`apps/website` are the documentation site and marketing site, both apps in the same pnpm workspace.

Each core package follows the same layered, DDD-lite structure (see
[Architecture](../concepts/architecture)):

```
api      → HTTP surface (storage-api, documents-api, ...)          depends on domain
domain   → interfaces (StorageRepository, ...), no runtime deps
impl     → concrete implementations (storage-fs, storage-r2, ...)  depends on domain
shared   → no internal dependencies (core, crypto, i18n, json-api)
```

A **domain** package (e.g. `documents`) defines an interface; an **implementation** package (e.g.
`documents-drizzle`) implements it; an **api** package (e.g. `documents-api`) exposes it over HTTP.
Use an existing triple under `packages/laikacms/src` (`domain/storage`, `impl/storage-fs`,
`api/storage-api`) as the reference shape when adding a new one.

## Guide

1. [Local setup](./local-setup) — clone, install, build.
2. [Inner loop](./inner-loop) — test, lint, typecheck, dev, and where to add code.
3. [Landing a PR](./landing-a-pr) — branch naming, changesets, commit convention, CI checks.
4. [House style](./house-style) — the conventions a reviewer will hold you to.

Other pages in this section:

- **[Starter templates](./starters)** — status of the `starter-*` reference apps and the core
  building blocks they demonstrated.
- **[Package reference docs](./package-docs)** — where package-specific reference/usage docs live
  and how they're aggregated into this site.

Design decisions (ADRs, incident write-ups) are recorded internally, not on this public site.

The full contribution workflow also lives in
[CONTRIBUTING.md](https://github.com/laikacms/laikacms/blob/develop/CONTRIBUTING.md) at the repo
root.
