# starter-honox-blog

A blog starter built with [HonoX](https://github.com/honojs/honox) (Hono's file-based meta-framework) and [LaikaCMS](https://github.com/laikacms/laikacms).

HonoX routes are Web-API-native: `c.req.raw` is a standard `Request`, so `laika.fetch(c.req.raw)` requires no adapter bridge.

## Getting started

```sh
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) for the blog and [http://localhost:5173/admin/](http://localhost:5173/admin/) for the CMS.

## How it works

| File | Role |
|------|------|
| `src/laika.ts` | `createEmbeddedLaika` — single instance shared across all routes |
| `app/routes/index.tsx` | Home page — lists posts via `laika.documents.listRecordSummaries` |
| `app/routes/blog/[slug].tsx` | Post page — fetches a single post via `laika.documents.getDocument` |
| `app/routes/api/decap/[...path].ts` | Decap JSON:API — `laika.fetch(c.req.raw)` |
| `src/admin-client.ts` | Bundled by esbuild; registers the Laika backend and inits Decap CMS |
| `src/decap-config.ts` | Shared Decap collection config (used by both server and admin bundle) |

## Building for production

```sh
pnpm build
pnpm preview
```
