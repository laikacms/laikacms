# Starter templates

> **Moved out of the monorepo (June 2026).** The ~160 `starter-*` reference apps that used to live
> under `apps/` were removed from `laikacms/laikacms` as part of the
> [June 2026 restructure](./restructure-2026-06.md). They are being relocated to their own
> repositories.

## What the starters were

Each starter was a small, copy-or-run reference app showing how LaikaCMS is wired into one frontend
framework, runtime, or storage backend (Next.js, Astro, SvelteKit, Nuxt, Hono, Cloudflare Workers,
AWS Lambda, and many more). They favored **FileSystem storage** (`laikacms/storage/fs`) so anyone
could run them without a cloud account.

## Where they are now

The starter repositories are still being published — locations are **TBD**. This page will be
updated with links once they are available.

In the meantime, the core wiring the starters demonstrated is documented directly:

- [Getting Started](./getting-started.md) — install and basic usage.
- [Decap Integration](./decap-integration.md) — admin mounting, storage wiring, auth modes.
- [Deployment](./deployment.md) — runtime- and host-specific notes.
- [Packages](./packages.md) — the subpath exports each starter imported.

## Building blocks the starters used

These still ship in the core packages and are the recommended starting point when wiring a new app
by hand:

- `@laikacms/decap/decap-api` — `decapApi(...)`, the Decap-compatible HTTP API over your storage
  repos. Mount its `.fetch` on a catch-all route.
- `@laikacms/decap-cms/backends/laika` — `createLaikaBackend()`, the Decap CMS backend the admin UI
  registers to talk to that API.
- `@laikacms/decap/decap-oauth2` — `decapOauth2(...)`, an optional PKCE OAuth2 login server.
- A `StorageRepository` for your runtime — `laikacms/storage/fs` (Node), `laikacms/storage/r2`
  (Workers / R2), `laikacms/storage/drizzle`, `laikacms/storage/webdav`, etc.

Construct a storage repo, wrap it in `ContentBaseDocumentsRepository` /
`ContentBaseAssetsRepository`, pass them to `decapApi(...)`, and mount `.fetch` from your
framework's catch-all route. `decapApi(...)` returns `{ fetch, authenticateRequest }`; call the
repos directly from server-side render paths to bypass the (authenticated) HTTP API.
