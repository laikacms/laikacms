# `@laikacms/starter-hono-backend`

A **headless backend** built on Hono + Node.js. Exposes LaikaCMS content over JSON:API and serves a
Decap CMS admin at `/admin`. Brings no frontend — point any client you like at it.

Use this starter when you want:

- A standalone CMS backend that any frontend (web, mobile, native, AI agent) can talk to.
- A reference for the smallest possible `createEmbeddedLaika` + Hono setup.
- A pattern that ports directly to Cloudflare Workers, Bun, Deno, or AWS Lambda by swapping
  `@hono/node-server` for the respective Hono adapter.

## Stack

- Hono (any-runtime web framework)
- `@hono/node-server` for the dev runtime
- `laikacms` — FileSystem storage + ContentBase document model
- `@laikacms/decap-integrations/embedded` — one-call backend wiring
- Decap CMS shell loaded from a CDN at `/admin`

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-hono-backend dev
```

Then:

- `curl http://localhost:3000/` — endpoint index + sample post count
- `curl http://localhost:3000/posts` — list of published posts
- `curl http://localhost:3000/posts/hello-world` — single post
- Open `http://localhost:3000/admin` — Decap CMS admin (writes back to `content/posts/`)

## Endpoints

| Method | Path           | Auth | Description                                             |
| ------ | -------------- | ---- | ------------------------------------------------------- |
| GET    | `/`            | no   | API info, endpoint list, post count                     |
| GET    | `/admin`       | no   | Decap CMS admin shell (loaded from CDN)                 |
| ANY    | `/api/decap/*` | yes  | LaikaCMS JSON:API. Requires Bearer token.               |
| GET    | `/posts`       | no   | All published posts, JSON. Reads the repo directly.     |
| GET    | `/posts/:slug` | no   | Single published post by slug. Reads the repo directly. |

The custom `/posts*` endpoints are illustrations of the **direct-repo** pattern: they bypass the
authenticated HTTP API by calling `laika.documents.listRecords(...)` /
`laika.documents.getDocument(...)` and draining the result with `runTask` / `collectStream` from
`laikacms/compat`. The authenticated `/api/decap/*` route is what the Decap admin calls.

## Layout

```
apps/starter-hono-backend/
├── content/
│   └── posts/
│       └── hello-world.md
├── src/
│   ├── server.ts                  # Hono app + serve()
│   ├── lib/
│   │   ├── laika.ts               # createEmbeddedLaika instance
│   │   └── decap-config.ts        # collection schema
│   └── admin/
│       └── index.html             # Decap CMS admin shell
└── tsconfig.json
```

## Production

1. **Auth.** Swap `auth: { mode: 'dev' }` for
   `auth: { mode: 'custom', authenticateAccessToken:
   yourValidator }`.
2. **Storage.** `FileSystemStorageRepository` needs a persistent volume. Mount one or swap to
   `R2StorageRepository` / `GitHubStorageRepository`.
3. **Decap shell.** `/admin` loads from CDNs — fine for dev; self-host for prod.
4. **Runtime.** Replace `@hono/node-server` with `@hono/cloudflare-workers`, `bun`, etc. as needed.
   See [`docs/deployment.md`](../../docs/deployment.md).

## Why this app exists

Reference starter for the LaikaCMS monorepo. See [`docs/starters.md`](../../docs/starters.md).
