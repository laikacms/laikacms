---
title: laikacms
order: 1
---

# `laikacms`

The core package: domain types, API factories, default implementations, serializers, and shared
utilities. API-first, runtime-agnostic — runs on Node, Bun, and Cloudflare Workers. Imported via
subpath exports so consumers only bundle what they use.

```bash
pnpm add laikacms
```

See [Usage](./usage) for quick-start examples, or the [package map](/reference/packages) for the
exhaustive table of every export.

## Companion packages

- [`@laikacms/server`](/reference/packages/server/) — Decap CMS integrations (backend, OAuth2,
  widgets)
- [`@laikacms/github`](https://www.npmjs.com/package/@laikacms/github) — GitHub-backed storage
  repository
- [`@laikacms/gitlab`](https://www.npmjs.com/package/@laikacms/gitlab) — GitLab-backed storage
  repository
- [`@laikacms/bitbucket`](https://www.npmjs.com/package/@laikacms/bitbucket) — Bitbucket-backed
  storage repository
