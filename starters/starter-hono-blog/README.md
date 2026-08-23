# starter-hono-blog

A blog built with **[Hono](https://hono.dev/) + Node.js + LaikaCMS**.

Uses [`createEmbeddedLaika`](https://docs.laikacms.com) to spin up a `FileSystemStorageRepository` + CatalogDocuments/Assets stack in a single call. Blog routes read content directly from `laika.documents` — no extra HTTP round-trip.

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000> — the blog is at `/`, the Decap admin at `/admin/`.

## Working from the monorepo

If you cloned the `laikacms` repository and are running this starter in-place (not via the wizard),
the `starters/pnpm-workspace.yaml` carries `link:` overrides pointing at local builds of packages
that are ahead of npm. Build those packages first, then install and run:

```sh
# Build the linked packages (run from this directory)
pnpm -C ../.. --filter laikacms --filter @laikacms/server build

pnpm install
pnpm dev
```

The admin logs in automatically via **dev token auth** (no password needed in development). Change `auth: { mode: 'dev' }` in `src/laika.ts` to add real authentication.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Build the admin bundle, then start the server with hot-reload (`tsx watch`) |
| `npm start` | Start the server without rebuilding the admin bundle |
| `npm run build` | Build the admin bundle only (for production, pre-build before deploy) |
| `npm run typecheck` | TypeScript type-check (no emit) |

## How it's wired

```
src/laika.ts          createEmbeddedLaika — FileSystem + Catalog + Decap API
src/decap-config.ts   Decap collection definitions (shared with admin bundle)
src/index.ts          Hono server: /api/decap/* → laika.fetch, blog routes, static files
src/admin-client.ts   Admin entry point (bundled to public/admin/bundle.js)
src/cms.ts            Decap bare-app registration (widgets, backend)
content/              Markdown post files (created by Decap admin)
content/uploads/       Media uploads (served at /uploads/* by Hono)
```

`createEmbeddedLaika` roots a `FileSystemStorageRepository` at `content/`, seeds `config.yml` from the `decapConfig` option, and returns a `fetch`-compatible handler for the Decap JSON:API + auth endpoints. Import `laika.documents` in any route to read/write content without going through HTTP.

## Customise

- **Collections** — edit `src/decap-config.ts`. Changes apply to both the server and admin UI automatically.
- **Port** — set the `PORT` environment variable (default: `3000`).
- **Auth** — set `auth: { mode: 'bearer', token: process.env.ADMIN_TOKEN }` in `src/laika.ts` for a static bearer token, or wire a real user database.
- **Content directory** — change the `contentDir` option in `src/laika.ts`.
