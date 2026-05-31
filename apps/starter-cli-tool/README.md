# `@laikacms/starter-cli-tool`

A tiny **Node.js CLI** for reading and writing LaikaCMS content from the shell. Demonstrates that
the LaikaCMS API works equally well from scripts and CI as from a web server — no framework
required, no HTTP layer.

Use this starter when you want:

- **Build-time content fetching** for static site generators (Astro, Eleventy, Hugo, etc.).
- **CI scripts** that publish/unpublish content as part of a release pipeline.
- **Content migrations** between repos or between LaikaCMS and another CMS.
- **Backups** — `laika list` + `laika get` to dump everything to a directory.

## Stack

- Node.js 22 + `tsx` (for dev — production builds compile to plain `.js`)
- `@laikacms/decap-integrations/embedded` — `createEmbeddedLaika` over local FileSystem

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-cli-tool dev list                 # list posts/
pnpm --filter @laikacms/starter-cli-tool dev get posts/hello-world
echo "# A new post" | pnpm --filter @laikacms/starter-cli-tool dev add posts/foo --title="Foo"
pnpm --filter @laikacms/starter-cli-tool dev publish posts/foo
pnpm --filter @laikacms/starter-cli-tool dev delete posts/foo
```

Or symlink `./src/cli.ts` into your `PATH` and run `laika list` directly.

## Commands

| Command                     | What it does                                          |
| --------------------------- | ----------------------------------------------------- |
| `laika list [folder]`       | tab-separated list of published documents in a folder |
| `laika get <key>`           | print a single document as JSON                       |
| `laika add <key> --title=…` | create an unpublished document; reads body from stdin |
| `laika publish <key>`       | flip an unpublished document to published             |
| `laika delete <key>`        | delete a published document                           |

`LAIKA_CONTENT_DIR` overrides the default `./content` location.

## Why this exists

LaikaCMS is "API-first" — every operation is a method on a repository. The web server is one client;
the CLI is another. Wiring it as a CLI:

- Confirms the API is genuinely usable outside of `(Request) => Response` contexts.
- Gives you `xargs`-compatible operations:
  `laika list posts | awk '{print $1}' | xargs -I{} laika get {}`.
- Surfaces friction: if some operation isn't ergonomic from a shell, that's a doc/API gap to
  capture. Add it to [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).

## Layout

```
apps/starter-cli-tool/
├── content/posts/hello-world.md
├── src/cli.ts                          # the entire CLI, ~120 lines
└── tsconfig.json
```

## Production hardening

Distribute as an npm package (`bin: { laika: './dist/cli.js' }`) for global install — or bundle to a
single executable with `esbuild` / `bun build --compile`.
