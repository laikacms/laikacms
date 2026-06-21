# Starter templates

> **Moved out of the monorepo (June 2026).** The ~160 `starter-*` reference apps that used to live
> under `apps/` were removed from `laikacms/laikacms` as part of the
> [June 2026 restructure](./restructure-2026-06.md). They are being relocated to their own
> repositories.

## What the starters were

Each starter was a small, copy-or-run reference app showing how LaikaCMS is wired into one frontend
framework, runtime, or storage backend (Next.js, Astro, SvelteKit, Nuxt, Hono, Cloudflare Workers,
AWS Lambda, and many more). They favored the **embedded preset**
(`@laikacms/decap-integrations/embedded`) and FileSystem storage so anyone could run them without a
cloud account.

## Where they are now

The starter repositories are still being published — locations are **TBD**. This page will be
updated with links once they are available.

In the meantime, the core wiring the starters demonstrated is documented directly:

- [Getting Started](./getting-started.md) — install and basic usage.
- [Decap Integration](./decap-integration.md) — presets, admin mounting, auth modes.
- [Deployment](./deployment.md) — runtime- and host-specific notes.
- [Packages](./packages.md) — the subpath exports each starter imported.

## Building blocks the starters used

These still ship in the core packages and are the recommended starting point when wiring a new app
by hand:

- `@laikacms/decap-integrations/embedded` — `createEmbeddedLaika`, `minimalBlogConfig`,
  `decapAdminHtml()` (Node.js / FileSystem).
- `@laikacms/decap-integrations/workers` — `createWorkersLaika` (Cloudflare Workers / R2).
- `@laikacms/decap-integrations/custom` — `createCustomLaika({ storage, … })` for any pre-built
  `StorageRepository`.

All three return the same shape: `{ fetch, authenticateRequest, storage, documents, assets }`. Mount
`fetch` from your framework's catch-all route; call the repos directly from server-side render paths
to bypass the (authenticated) HTTP API.
