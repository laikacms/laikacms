# starter-vite-react-blog

A blog built with **bare Vite SSR + React + Express + LaikaCMS** — no meta-framework.

Shows the raw primitives that Next.js and TanStack Start abstract away: Express request handling, `renderToStaticMarkup`, and the Decap API proxied through a catch-all route. Uses [`createEmbeddedLaika`](https://docs.laikacms.com) for the same one-call server setup as the Hono starter.

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000> — the blog is at `/`, the Decap admin at `/admin/`.

The admin uses **dev token auth**: no password required in development.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Build the admin bundle, then start the server with hot-reload (`tsx watch`) |
| `npm start` | Start the server without rebuilding the admin bundle |
| `npm run build` | Build the admin bundle only |
| `npm run typecheck` | TypeScript type-check (no emit) |

## How it's wired

```
src/laika.ts          createEmbeddedLaika — FileSystem + Catalog + Decap API
src/decap-config.ts   Decap collection definitions (shared with admin bundle)
src/server.tsx        Express server: /api/decap/* → laika.fetch, SSR blog routes, static files
src/pages.tsx         React components (renderToStaticMarkup — no hydration)
src/admin-client.ts   Admin entry point (bundled to public/admin/bundle.js)
src/cms.ts            Decap bare-app registration (widgets, backend)
content/              Markdown post files
public/uploads/       Media uploads
```

Blog routes call `laika.documents.listRecordSummaries` / `getDocument` directly — no HTTP round-trip. The Express `/api/decap/*` catch-all converts the Node.js `IncomingMessage` to a Web API `Request` before forwarding to `laika.fetch`.

## Customise

- **Collections** — edit `src/decap-config.ts`.
- **Port** — set the `PORT` environment variable (default: `3000`).
- **Auth** — change `auth: { mode: 'bearer', token: process.env.ADMIN_TOKEN }` in `src/laika.ts`.
- **Hydration** — swap `renderToStaticMarkup` for `renderToString` + client `hydrateRoot` and pass server data via a `<script>` tag.
