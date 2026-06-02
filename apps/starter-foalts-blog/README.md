# starter-foalts-blog

Minimal blog built with [FoalTS v4](https://foalts.org) and LaikaCMS. Demonstrates **decorator-based
TypeScript MVC** with a clean Decap API proxy pattern.

## Key pattern — outer Express wrapper for raw body access

FoalTS registers its own body parser inside `createApp`. This means any middleware added to the
FoalTS app after the fact runs _after_ body parsing and can no longer read binary upload bodies.

The fix: wrap the FoalTS app inside a plain Express app and register `express.raw()` on the outer
app **before** mounting FoalTS:

```ts
// src/index.ts
const outer = express();

// express.raw() captures body as Buffer before FoalTS body parser runs
outer.use('/api/decap', express.raw({ type: '*/*' }), async (req, res) => {
  const webReq = new Request(`http://localhost:${PORT}${req.originalUrl}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : null,
  });
  const webRes = await laika.fetch(webReq);
  // ... forward response
});

const foalApp = await createApp(AppController);
outer.use(foalApp); // FoalTS handles everything else
```

> **Doc gap fixed**: this pattern is now documented in
> [`docs/decap-integration.md`](../../docs/decap-integration.md) under the _framework adapter
> matrix_.

## Features

- **FoalTS controllers** — `BlogController` and `AdminController` with `@Get` decorators
- **SSR blog** — lists and renders posts via `laika.documents.listRecordSummaries` /
  `laika.documents.getDocument`
- **`laika.documents.*` via `laikacms/compat`** — `collectStream` / `runTask` (same API as all other
  starters)
- **Decap admin from CDN** — admin UI at `/admin/`; laika backend at `/api/decap/*`

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin/> for the Decap CMS
editor (dev auth token applied automatically).

## Structure

```
apps/starter-foalts-blog/
├── content/posts/          # Markdown content files
├── src/
│   ├── index.ts            # Entry: outer Express wrapper + FoalTS app
│   └── app/
│       ├── laika.ts        # createEmbeddedLaika + minimalBlogConfig
│       ├── app.controller.ts   # FoalTS root controller (registers sub-controllers)
│       ├── blog.controller.ts  # GET / and GET /blog/:slug
│       └── admin.controller.ts # GET /admin
├── package.json
└── tsconfig.json
```
