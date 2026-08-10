# Laika CMS starters

Download-and-go templates. Each starter is a small, self-contained blog showing one way LaikaCMS is
wired into a framework, runtime, or storage backend. Nothing here depends on this monorepo's
workspace.

**Always create apps through the wizard**, not by copying a folder:

```bash
npx laikacli create
```

The wizard picks the starter, then asks which CMS **backends, widgets, and locales** to install and
generates the app's `src/cms.ts` from that selection (flags `--backends`/`--widgets`/`--locales` or
`--yes` skip the prompts). Every starter boots the **bare, non-laika Decap app**
(`@laikacms/decap-cms/laika-app/bare`) — no CDN bundle, no laika-styled chrome — and registers only what
`src/cms.ts` lists, so the admin bundle contains exactly what the site uses.

> **Curated 5 of ~140 (LCMS-455).** In June 2026 the ~160 `starter-*` reference apps were moved out
> of the monorepo. This is the curated set of five, each mapped to a Getting Started section and
> (eventually) embedded as a StackBlitz preview. The remaining **~135 are deferred, not dropped** —
> they'll be migrated as demand warrants.

## The five

| Starter | Docs section | Demonstrates |
| --- | --- | --- |
| [`starter-vite-react-blog`](./starter-vite-react-blog) | Client | client-side content wiring |
| [`starter-hono-blog`](./starter-hono-blog) | Server (default) | secure-by-default `decap-api` proxy |
| [`starter-workers-blog`](./starter-workers-blog) | Server → edge | runtime-agnostic Cloudflare deploy |
| [`starter-astro-blog`](./starter-astro-blog) | Static | build-time compilation via the vite plugin |
| [`starter-github-blog`](./starter-github-blog) | Grows into | DB-free, git-backed collections |

## Why not the workspace?

A starter has to install for someone who cloned _just that folder_, so its `package.json` references
**published** LaikaCMS versions as caret ranges (`"laikacms": "^3.0.1"`) — never `workspace:`,
`catalog:`, `link:`, or `file:` protocols, which only resolve inside this repo.

Those ranges are kept current automatically: the root `version` script runs
`changeset version && node scripts/sync-starter-versions.mjs`, so every release rewrites each
starter's `laikacms` / `@laikacms/*` dependency to the just-published version. CI enforces it with
`pnpm check:starters` (`scripts/check-starter-versions.mjs`), which fails on version drift or any
workspace-protocol dependency.

## Status: source migration pending

> ⚠️ These trees were migrated from the pre-restructure app set (their `package.json` files are
> already on current published versions). The **admin UI is migrated**: every starter now bundles
> the bare, non-laika `@laikacms/decap-cms/laika-app/bare` with registrations in a wizard-generated
> `src/cms.ts` — no CDN `decap-cms@3` bundle, no `@laikacms/decap-integrations` /
> `@laikacms/decap-cms-backend-laika` admin imports. Before a starter's StackBlitz embed goes live
> its **server side** must still:
>
> - replace `starter-workers-blog`'s `@laikacms/cloudflare` imports with `laikacms/storage/r2`;
> - adopt the `decap-api` `authorize` callback (secure-by-default); and
> - for `starter-vite-react-blog`, adopt `WebStorageRepository` — **blocked on LCMS-451**.
>
> CI validation (build each starter against the local library build via a dependency override)
> lands with that migration.
