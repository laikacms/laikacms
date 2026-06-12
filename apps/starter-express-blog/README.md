# `@laikacms/starter-express-blog`

Minimal blog built with [Express](https://expressjs.com) v5 and LaikaCMS. Demonstrates:

- **`createEmbeddedLaika`** — one call wires up filesystem storage, Decap config syncing, documents
  repo, and the Decap JSON:API fetch handler.
- **Express → Web API bridge** — `laika.fetch` expects a WHATWG `Request`; Express exposes Node's
  `IncomingMessage`. We reconstruct a `Request` from the buffered raw body.
- **`laika.documents.*` via `laikacms/compat`** — `runTask` / `collectStream` give Promise-friendly
  access to content without importing Effect.
- **Decap admin bundled locally** — `decap-cms-app` and the laika backend plugin are bundled by
  esbuild into `public/admin/bundle.js`; no CDN or unpkg involved.

## Prerequisites

This starter lives inside the LaikaCMS monorepo. Workspace packages (`laikacms`,
`@laikacms/decap-integrations`) must be compiled before the dev server starts. The `predev` script
handles this automatically — it runs `turbo build` over those deps before `tsx watch` launches.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin/> for the CMS editor (dev
auth — no login required).

## Scripts

| Script           | What it does                                               |
| ---------------- | ---------------------------------------------------------- |
| `pnpm dev`       | Build workspace deps, bundle admin client, start tsx watch |
| `pnpm build`     | Bundle admin client for production                         |
| `pnpm start`     | Run the server (dist must already exist)                   |
| `pnpm typecheck` | TypeScript type-check only (no emit)                       |

## Project layout

```
src/
  decap-config.ts     # Shared collection schema (server + admin)
  laika.ts            # createEmbeddedLaika singleton
  index.ts            # Express server — routes + static files
  admin-client.ts     # Bundled for browser: registers laika backend
public/
  admin/
    index.html        # Decap admin UI shell (loads local bundle.js)
    bundle.js         # Built from admin-client.ts by esbuild
content/              # Filesystem content root (git-tracked)
```

## Routes

| Method | Path           | Description                                 |
| ------ | -------------- | ------------------------------------------- |
| GET    | `/`            | Blog index — lists all published posts      |
| GET    | `/blog/:slug`  | Single post page                            |
| GET    | `/admin/`      | Decap CMS admin shell                       |
| ANY    | `/api/decap/*` | LaikaCMS JSON:API — used by the Decap admin |

## Deployment

```bash
pnpm start   # or: NODE_ENV=production tsx src/index.ts
```

Set `PORT` to override the default 3000. Point a reverse proxy (nginx, Caddy) at the Node server.

For production, swap `auth: { mode: 'dev' }` for a real token validator and mount a persistent
volume (or swap `FileSystemStorageRepository` for `GitHubStorageRepository`).
