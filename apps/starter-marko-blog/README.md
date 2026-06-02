# `@laikacms/starter-marko-blog`

A blog rendered with **[Marko](https://markojs.com)** — eBay's tag-based UI language with streaming,
out-of-order SSR. Different from every other SSR starter: Marko templates are **not** JSX, and the
runtime streams HTML as data resolves.

## Stack

- Marko 5 + `@marko/run` (file-based routing, framework runner)
- `@marko/run-adapter-node` for the Node.js server
- `laikacms` — FileSystem storage + ContentBase document model
- `@laikacms/decap-integrations/embedded` — `createEmbeddedLaika`, `minimalBlogConfig`,
  `decapAdminHtml`

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-marko-blog dev
```

Then:

- `http://localhost:3000` — public blog
- `http://localhost:3000/admin` — Decap CMS admin

## Layout

```
apps/starter-marko-blog/
├── content/posts/hello-world.md
├── src/
│   ├── server/
│   │   ├── laika.ts                       # createEmbeddedLaika
│   │   └── posts.ts                       # repo reads + types
│   └── routes/
│       ├── +layout.marko                  # shared chrome
│       ├── +page.marko                    # / — awaits listPosts()
│       ├── posts/$slug/+page.marko        # /posts/:slug
│       ├── admin/+handler.ts              # /admin — decapAdminHtml()
│       └── api/decap/$$rest/+handler.ts   # /api/decap/* → laika.fetch
└── tsconfig.json
```

## Why Marko?

Two reasons:

1. **Different language model.** Marko templates use significant indentation, tag-like syntax, and
   inline `$` for JS expressions. Some developers find this much more compact than JSX. It compiles
   to tiny client bundles.
2. **Out-of-order streaming.** When `await listPosts()` is slow, Marko streams the surrounding HTML
   immediately and patches in the post list when it's ready. Time-to-first-byte is faster than
   equivalent React/Vue SSR for many workloads.

## Production hardening

Same checklist as the other starters. See [`docs/starters.md`](../../docs/starters.md).
