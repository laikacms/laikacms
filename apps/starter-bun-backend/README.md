# `@laikacms/starter-bun-backend`

A **headless backend** on the [Bun](https://bun.sh) runtime. Exposes LaikaCMS over JSON:API and
serves a Decap CMS admin at `/admin`. The same `createEmbeddedLaika` module that powers
`starter-hono-backend` on Node.js — no changes — running on a different runtime, with no Hono and no
`tsx` middleman.

Use this starter when you want:

- A demonstration that the LaikaCMS embedded preset is **runtime-portable** (Node, Bun, Deno — same
  code).
- The fastest possible startup time. Bun cold-starts noticeably quicker than Node + tsx.
- A minimal example of `Bun.serve()` with the web-standard `fetch` handler.

## Stack

- Bun ≥ 1.1 (you provide it)
- `laikacms` — FileSystem storage + ContentBase document model
- `@laikacms/decap-integrations/embedded` — `createEmbeddedLaika` + `minimalBlogConfig`
- Decap CMS shell served from `src/admin/index.html`

## Run

You'll need [Bun installed](https://bun.sh/docs/installation). Then:

```bash
pnpm install                                            # workspace-level deps
pnpm --filter @laikacms/starter-bun-backend dev         # bun --watch src/server.ts
```

Then:

- `curl http://localhost:3000/` — runtime info + endpoint list
- `curl http://localhost:3000/posts` — list published posts
- Open `http://localhost:3000/admin` — Decap CMS admin

## Endpoints

Same shape as `starter-hono-backend`:

| Method | Path           | Auth | Description                                         |
| ------ | -------------- | ---- | --------------------------------------------------- |
| GET    | `/`            | no   | API info (runtime, endpoint list)                   |
| GET    | `/admin`       | no   | Decap CMS admin shell                               |
| ANY    | `/api/decap/*` | yes  | LaikaCMS JSON:API (Bearer token required)           |
| GET    | `/posts`       | no   | All published posts (reads repo directly)           |
| GET    | `/posts/:slug` | no   | Single published post by slug (reads repo directly) |

## Layout

```
apps/starter-bun-backend/
├── content/
│   └── posts/
│       └── hello-world.md
├── src/
│   ├── server.ts                  # Bun.serve() entry
│   ├── lib/
│   │   └── laika.ts               # createEmbeddedLaika instance
│   └── admin/
│       └── index.html             # Decap CMS shell
└── tsconfig.json
```

## Why no Hono?

To prove the point: Bun's native `Bun.serve({ fetch })` is a web-standard request handler. Any
LaikaCMS preset that returns a `(Request) => Promise<Response>` plugs straight in. Hono is a great
choice when you want routing helpers, but you don't _need_ it.

## Production hardening

Same checklist as the other starters: real auth, persistent storage, self-hosted Decap shell. See
[`docs/starters.md`](../../docs/starters.md).
