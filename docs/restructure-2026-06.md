# Monorepo restructure (June 2026)

In June 2026 the `laikacms/laikacms` repository was **stripped down to its core**. The example apps
and most of the satellite packages were removed from this monorepo so that the repo only carries the
code that ships as the core product. Removed packages that are still published to npm continue to be
developed in their own repositories.

This document is the record of what changed, why, and where things went.

## Why

The monorepo had grown to ~170 example apps and ~150 packages. The vast majority of that surface
area was reference material (starter templates) or optional integrations that:

- slowed down `pnpm install`, builds, and CI,
- coupled the release of the core packages to a long tail of adapters and demos, and
- made the repository hard to navigate for someone who just wants the core CMS.

Splitting them out keeps this repo focused on the core domain, APIs, and the two Decap integration
packages, while the adapters and examples evolve independently on their own release cadence.

## What the repo contains now

Three published packages remain:

| Package              | Path                | Description                                                           |
| -------------------- | ------------------- | --------------------------------------------------------------------- |
| `laikacms`           | `packages/laikacms` | Core domain, APIs, default implementations, serializers, shared utils |
| `@laikacms/decap`    | `packages/decap`    | Decap CMS integrations: backend, OAuth2, widgets, server adapters     |
| `@laikacms/decap-ai` | `packages/decap-ai` | AI chat integration for Decap CMS (Vercel AI SDK)                     |

The `apps/` directory no longer exists.

## What was removed

### Apps (164 directories)

The entire `apps/` tree was deleted:

- **159 `starter-*` templates** — one reference app per framework / runtime / storage backend
  (Next.js, Astro, SvelteKit, Nuxt, Hono, Workers, Lambda, and many more).
- **5 non-starter apps**: `decap-cms-laika-app`, `laika-gateway`, `storage-contract-e2e`,
  `storybook`, and `website`.

### Packages (8 top-level directories, 100+ npm packages)

| Removed path                                    | Contents                                                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/integrations/*`                       | ~40 storage / asset / auth adapters (`@laikacms/aws`, `@laikacms/github`, `@laikacms/algolia`, `@laikacms/supabase`, `@laikacms/mongodb`, …) |
| `packages/portable-text/*`                      | ~67 `portable-text-to-*` mapper packages + `@laikacloud/portabletext-core`                                                                   |
| `packages/tools/*`                              | `laikacli` and `@laikacms/dynamodb-local`                                                                                                    |
| `packages/git-gateway`                          | `@laikacms/git-gateway`                                                                                                                      |
| `packages/decap-cms-lexical-core`               | Lexical editor core for the Decap fork                                                                                                       |
| `packages/decap-cms-widget-lexicaleditor`       | Lexical rich-text widget                                                                                                                     |
| `packages/decap-cms-widget-portabletext-editor` | Portable Text editor widget                                                                                                                  |
| `packages/shared`                               | Internal build/shared helpers                                                                                                                |

## Where it went

Packages that are still published to npm — including `@laikacms/git-gateway`, the storage/asset
adapters that lived under `packages/integrations/*` (`@laikacms/aws`, `@laikacms/github`, …),
`laikacli`, and the `portable-text-to-*` mappers — are now maintained in **separate repositories**.
Their npm package names are unchanged, so consumers install them exactly as before:

```bash
pnpm add @laikacms/github
pnpm add -D laikacli
```

> **Note:** the new repository locations are still being finalized (TBD). This document and the
> package docs will be updated with links once the destination repos are published. Internal-only
> packages (`packages/shared`, build tooling) were dropped rather than relocated.

## Docs affected by this change

The following docs described the removed apps/packages and were updated to match the stripped-down
repo:

- [`docs/starters.md`](./starters.md) — starter templates moved out of the monorepo.
- [`docs/packages.md`](./packages.md) — distinguishes in-repo packages from those developed
  elsewhere.
- `README.md` — Packages / Apps / Releasing sections.
- `LLM-GUIDE.md` — starter references are now external.
- `pnpm-workspace.yaml` — workspace globs trimmed to the three remaining packages.

## See also

- The cleanup commit: `8c3a81c` — _"chore: removed package bloat and moved out of monorepo"_.
