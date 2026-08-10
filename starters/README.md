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
> (eventually) embedded as a StackBlitz preview, plus `starter-opfs-blog` (added for
> `laikacms/storage/web-fs`). The remaining **~135 are deferred, not dropped** — they'll be
> migrated as demand warrants.

## The starters

| Starter | Docs section | Demonstrates |
| --- | --- | --- |
| [`starter-vite-react-blog`](./starter-vite-react-blog) | Client | client-side content wiring |
| [`starter-opfs-blog`](./starter-opfs-blog) | Client → local-first | serverless in-browser storage: OPFS or a picked local folder (`storage/web-fs`) |
| [`starter-hono-blog`](./starter-hono-blog) | Server (default) | secure-by-default `decap-api` proxy |
| [`starter-workers-blog`](./starter-workers-blog) | Server → edge | runtime-agnostic Cloudflare deploy |
| [`starter-astro-blog`](./starter-astro-blog) | Static | build-time compilation via the vite plugin |
| [`starter-github-blog`](./starter-github-blog) | Grows into | DB-free, git-backed collections |

## Working in this directory

Like `examples/`, this directory is its **own pnpm workspace**
([`pnpm-workspace.yaml`](./pnpm-workspace.yaml)): running `pnpm install` here (or inside a starter)
never climbs up into the monorepo's root workspace, and gets its own lockfile and `node_modules`.
Unlike `examples/`, it links nothing from the monorepo — installs resolve exactly the published
packages a user who downloaded one starter folder would get. To validate a starter against the
working tree instead, that's what `examples/` (workspace-linked `laikacms`) is for.

```sh
cd starters
pnpm install          # one isolated install for all starters
pnpm -r typecheck     # or -F @laikacms/starter-<name> for one
```

Note: `pnpm clean` at the repo root removes `node_modules` everywhere, including here — just re-run
`pnpm install` in this directory afterwards.

## Why not the (monorepo) workspace?

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
> `@laikacms/decap-cms/backends/laika` admin imports. Before a starter's StackBlitz embed goes live
> its **server side** must still:
>
> - replace `starter-workers-blog`'s `@laikacms/cloudflare` imports with `laikacms/storage/r2`;
> - adopt the `decap-api` `authorize` callback (secure-by-default); and
> - for `starter-vite-react-blog`, adopt `WebStorageRepository` — **blocked on LCMS-451**.
>
> `starter-opfs-blog` is fully client-side (no server half to migrate), but its published
> dependency range gains `laikacms/storage/web-fs` only with the next release. Until then two
> **temporary, revert-at-release** measures keep it runnable from this repo: a `laikacms` `link:`
> override in [`pnpm-workspace.yaml`](./pnpm-workspace.yaml) (build the library first), and booting
> `@laikacms/decap-cms/laika-app/bare` instead of the not-yet-published `app/bare` (TODO in its
> `src/cms.ts`).
>
> `starter-github-blog` currently cannot install at all: `@laikacms/github` is pinned to the
> workspace version (1.0.3) but the npm registry stopped at 1.0.0 — the version-sync machinery
> compares against workspace versions, so it can't catch a missed publish. It is excluded from
> [`pnpm-workspace.yaml`](./pnpm-workspace.yaml) until a release publishes the package.
>
> CI validation (build each starter against the local library build via a dependency override)
> lands with that migration.
