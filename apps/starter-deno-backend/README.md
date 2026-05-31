# `@laikacms/starter-deno-backend`

A **headless backend** on the [Deno 2](https://deno.com) runtime. Exposes LaikaCMS over JSON:API and
serves a Decap CMS admin at `/admin`. Demonstrates that LaikaCMS works on a runtime that isn't
Node.js or Bun — same `createEmbeddedLaika` preset, same web-standard fetch handler.

Use this starter when you want:

- The Deno developer experience (native TS, fine-grained permissions, single binary deploy).
- A reference for running pnpm-workspace packages from Deno via `nodeModulesDir: auto`.

## Stack

- Deno 2 + native `Deno.serve()`
- `laikacms` — FileSystem storage + ContentBase document model (resolved as `npm:laikacms`)
- `@laikacms/decap-integrations/embedded` — `createEmbeddedLaika` + `minimalBlogConfig`
- Decap CMS shell from a CDN

## Run

You'll need [Deno 2 installed](https://deno.com/manual/getting_started/installation), plus the
workspace dependencies (which Deno reads from the same `node_modules/` pnpm creates):

```bash
pnpm install                                              # populate node_modules with workspace symlinks
pnpm --filter @laikacms/starter-deno-backend dev          # deno run --watch src/main.ts
```

(`pnpm dev` here actually shells out to `deno run` under the hood — see the package.json scripts.
You can also run `deno task dev` directly from inside this directory.)

Then:

- `curl http://localhost:3000/` — runtime info + endpoint list
- `curl http://localhost:3000/posts` — list published posts
- Open `http://localhost:3000/admin` — Decap CMS admin

## Why `nodeModulesDir: auto`

The LaikaCMS workspace packages (`laikacms`, `@laikacms/decap-integrations`) aren't on npm — they
live in this monorepo. pnpm sets them up as symlinks under `node_modules/`. Deno's
`nodeModulesDir: "auto"` mode tells Deno: "when you see `npm:<spec>`, look in
`./node_modules/<spec>` first". That makes the symlinks transparent —
`npm:@laikacms/decap-integrations/embedded` resolves to the workspace source the same way Node
would.

In a "real" Deno project that depends on published npm packages, you wouldn't need this mode — you'd
just use `npm:<spec>@version` directly.

## Layout

```
apps/starter-deno-backend/
├── deno.json                  # Deno config (nodeModulesDir, imports, tasks)
├── package.json               # pnpm workspace metadata (deps + script aliases)
├── content/
│   └── posts/
│       └── hello-world.md
└── src/
    ├── main.ts                # Deno.serve() entry
    ├── lib/
    │   └── laika.ts           # createEmbeddedLaika instance
    └── admin/
        └── index.html         # Decap CMS shell
```

## Production hardening

Same checklist as the other starters: real auth, persistent storage, self-hosted Decap shell. For
Deno-specific deployment: `deno compile` to produce a single binary, or deploy to Deno Deploy (which
currently supports the subset of Node APIs LaikaCMS uses).

See [`docs/starters.md`](../../docs/starters.md).
