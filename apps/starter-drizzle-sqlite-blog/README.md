# `@laikacms/starter-drizzle-sqlite-blog`

A minimal blog built with [Hono](https://hono.dev) + [Drizzle ORM](https://orm.drizzle.team) over
libsql/SQLite and LaikaCMS. Demonstrates:

- **`createCustomLaika`** — the "BYO storage" pattern: bring any `StorageRepository` implementation
  and wire it into LaikaCMS without being locked to the built-in filesystem preset.
- **`DrizzleStorageRepository`** — stores content in a local SQLite database via `@libsql/client`
  and Drizzle ORM. Useful when you need a portable, single-file database instead of the filesystem.
- **`decapAdminHtml`** — generates the entire Decap admin page as a string, so no esbuild step or
  separate admin bundle is required.

## Prerequisites

- Node.js 22.x
- pnpm

## Getting started

This starter lives inside the LaikaCMS monorepo. Workspace packages (`laikacms`,
`@laikacms/decap-integrations`) must be compiled before the dev server starts. The `predev` and
`prestart` scripts handle this automatically.

```bash
git clone https://github.com/laikacms/laikacms.git
cd laikacms
pnpm install
cd apps/starter-drizzle-sqlite-blog
pnpm dev   # predev builds workspace deps, then starts tsx watch
```

Or from the repo root (Turbo resolves the dep graph for you):

```bash
pnpm turbo dev --filter @laikacms/starter-drizzle-sqlite-blog
```

## URLs

| URL                           | Description                                     |
| ----------------------------- | ----------------------------------------------- |
| `http://localhost:PORT/`      | Blog index                                      |
| `http://localhost:PORT/admin` | Decap CMS admin (no login required in dev mode) |

## Environment variables

| Variable | Default                  | Description                                                                                                         |
| -------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `PORT`   | `3000`                   | Port the server listens on                                                                                          |
| `DB_URL` | `file:laikacms.db` (cwd) | libsql connection URL. Use `file:<path>` for a local SQLite file, or a `libsql://` URL for a remote Turso database. |

## Scripts

| Script           | What it does                                             |
| ---------------- | -------------------------------------------------------- |
| `pnpm dev`       | Build workspace deps, then start tsx watch (auto-reload) |
| `pnpm start`     | Build workspace deps, then run the server once           |
| `pnpm typecheck` | TypeScript type-check only (no emit)                     |

## Why this starter exists

Reference for the **BYO storage** pattern in the LaikaCMS monorepo. See
[`docs/starters.md`](../../docs/starters.md).
