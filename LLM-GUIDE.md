# LaikaCMS for LLMs and Agents

A condensed entry point for anyone (LLM or human) bootstrapping with LaikaCMS in under five minutes.
If you're a coding agent dropped into a repo that wants to use LaikaCMS, **read this first**, then
[`docs/starters.md`](./docs/starters.md), then the specific docs you need.

---

## 1. The two-minute mental model

LaikaCMS is **three things stacked**:

```
┌─────────────────────────────────────────────────────────┐
│   HTTP API   (JSON:API)  — what Decap / clients call    │
│   ─ buildJsonApi / decapApi — web-standard fetch        │
├─────────────────────────────────────────────────────────┤
│   Domain      — what your server code calls             │
│   ─ Storage / Documents / Assets / ContentBase repos    │
├─────────────────────────────────────────────────────────┤
│   Storage backend (you choose ONE)                      │
│   ─ FileSystem (Node)   ─ R2 (Workers)                  │
│   ─ Drizzle (SQL)       ─ GitHub                        │
└─────────────────────────────────────────────────────────┘
```

You pick a **storage backend**, wrap it in **repos**, expose them through the **HTTP API**, and
mount the resulting `(Request) => Promise<Response>` handler in your framework.

The `@laikacms/decap-integrations` package ships a one-call **preset** that does all of this for
you. There are two presets:

- **`createEmbeddedLaika`** — Node.js runtime, FileSystem storage.
- **`createWorkersLaika`** — V8 isolates (Cloudflare Workers, Vercel Edge, etc.), R2 storage.

For 95% of starters: pick a preset, pass a config, mount `.fetch` on a catch-all route.

---

## 2. Five tasks with code

### a) Spin up a Node.js backend (Express/Hono/Fastify/Koa/Bun/Deno)

```ts
import {
  createEmbeddedLaika,
  decapAdminHtml,
  minimalBlogConfig,
} from '@laikacms/decap-integrations/embedded';
import { resolve } from 'node:path';

const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  decapConfig: minimalBlogConfig(), // pre-baked single-collection blog config
  basePath: '/api/decap',
  auth: { mode: 'dev' }, // dev token only — replace before prod
});

// Mount on every method at /api/decap/*:
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Serve the Decap CMS admin shell:
app.get('/admin', c => c.html(decapAdminHtml({ decapConfig: minimalBlogConfig() })));
```

### b) Render content server-side in a framework page (Next/SvelteKit/Astro/Nuxt/Remix/etc.)

```ts
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { laika } from '~/server/laika';

// List published posts in a folder:
const { items } = await collectStream(
  laika.documents.listRecords({
    folder: 'posts',
    depth: 1,
    pagination: { offset: 0, limit: 100 },
    type: 'published',
  }),
);

// Read one published document by key:
try {
  const doc = await runTask(laika.documents.getDocument('posts/hello-world'));
} catch (err) {
  if (err instanceof NotFoundError) {
    /* render 404 */
  }
}
```

### c) Deploy to Cloudflare Workers + R2

```ts
import {
  createWorkersLaika,
  decapAdminHtml,
  minimalBlogConfig,
} from '@laikacms/decap-integrations/workers';
import { Hono } from 'hono';

export interface Env {
  CONTENT: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

const makeLaika = (env: Env) =>
  createWorkersLaika({
    bucket: env.CONTENT,
    decapConfig: minimalBlogConfig(),
    basePath: '/api/decap',
    seedConfigOnFirstRequest: true, // writes config.yml to R2 on first request
    auth: { mode: 'dev' },
  });

app.all('/api/decap/*', c => makeLaika(c.env).fetch(c.req.raw));
app.get('/admin', c => c.html(decapAdminHtml({ decapConfig: minimalBlogConfig() })));

export default app;
```

### d) Use the HTTP API from a SPA (Vue/Solid/Lit/React-SPA)

**Don't.** Use a sidecar Node/Workers backend that exposes `/api/posts` etc. as public endpoints
(reading the repo directly), and have the SPA `fetch('/api/posts')`. See `apps/starter-vite-vue-spa`
or `apps/starter-vite-solid-spa` for the canonical sidecar pattern.

Why: the LaikaCMS HTTP API requires a Bearer token on every endpoint except `/health`. SPAs can't
safely hold one.

### e) Add real auth (production)

```ts
import { jwtVerify } from 'jose';

createEmbeddedLaika({
  // ... contentDir, decapConfig, basePath ...
  auth: {
    mode: 'custom',
    async authenticateAccessToken(token) {
      const { payload } = await jwtVerify(token, jwks);
      return { id: payload.sub, email: payload.email, name: payload.name };
    },
  },
});
```

---

## 3. The presets — choose the right one

| Preset                                                      | Runtime                            | Storage                        | Helpers re-exported                                        |
| ----------------------------------------------------------- | ---------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| `@laikacms/decap-integrations/embedded.createEmbeddedLaika` | Node, Bun, Deno                    | FileSystem                     | `minimalBlogConfig`, `decapAdminHtml`, `DEFAULT_DEV_TOKEN` |
| `@laikacms/decap-integrations/workers.createWorkersLaika`   | V8 isolates (Workers, Vercel Edge) | R2 (or `MinimalR2Bucket` shim) | same helpers (re-exported)                                 |

Both return `{ fetch, authenticateRequest, storage, documents, assets }`. Mount `.fetch` from your
framework's catch-all route. Use `.documents` / `.storage` / `.assets` directly from server render
code to **bypass HTTP auth** — server-internal reads don't need a token.

---

## 4. Non-obvious gotchas

These are the things that consistently bite first-time integrators:

1. **The HTTP API requires auth on every endpoint except `/health`.**
   - Server-side render reads must call the repos directly (via `laikacms/compat`'s `runTask` /
     `collectStream`), NOT through `laika.fetch(internalRequest)`.

2. **Express/Fastify/Koa: do NOT mount `express.json()` / Fastify body parsers / `koa-bodyparser` in
   front of `/api/decap/*`.**
   - The web-standard adapter streams the raw body to `laika.fetch`. Body parsers drain it first.
   - The Express/Fastify/Koa starters all have a custom adapter (`*-fetch-adapter.ts`) that handles
     the conversion correctly.

3. **`@laikacms/storage-fs` is NOT a separate package on npm.**
   - It's a subpath export of `laikacms`. Use
     `import { FileSystemStorageRepository } from
     'laikacms/storage-fs'`. Same for
     `storage-api`, `documents-api`, `storage-serializers-*`, etc.
   - The Decap backend lives at `@laikacms/decap-integrations/decap-cms-backend-laika` — a subpath
     of `@laikacms/decap-integrations`, NOT a separate `@laikacms/decap-cms-backend-laika` package.

4. **`createEmbeddedLaika` is Node-only.** It calls `node:fs.mkdirSync` at module-load time. Don't
   import it from Workers/edge code. Use `createWorkersLaika` instead.

5. **Workers/edge storage is currently R2-only.** Vercel Blob, Netlify Blobs, Deno KV, Bun S3 don't
   have first-party `StorageRepository` adapters yet. The Vercel Edge and Netlify Functions starters
   document this gap — for production on those platforms, write a small `StorageRepository` adapter
   or use `@laikacms/storage-gh` (GitHub-backed).

6. **Hide the Decap admin shell from your framework's hydration.** SSR frameworks hydrate the whole
   `<html>`. Decap also expects to own it. Pick one of:
   - Static file in `public/admin.html` (TanStack, Nuxt, Remix, SolidStart) — cleanest.
   - Iframe with `srcDoc` (Next App Router).
   - Inline server-rendered HTML response from a non-page route (SvelteKit `+server.ts`, Marko
     `+handler.ts`, Astro `is:inline`). The `decapAdminHtml()` helper from
     `@laikacms/decap-integrations/embedded` returns the HTML string ready to serve — use it instead
     of hand-rolling a 50-line static file.

7. **`workspace:*` for internal deps; `catalog:*` for shared external deps.** When adding a new
   starter under `apps/`, mirror this convention — see existing starters' `package.json`.

8. **Uploaded images are NOT raw files on disk — you must serve them yourself.**
   `ContentBaseAssetsRepository` (used by `createEmbeddedLaika`) encodes uploaded binaries as
   base64 inside a JSON object in the contentbase. Static-file middleware (`serveStatic`, etc.)
   cannot serve them. Add a dedicated route:
   ```ts
   app.get('/uploads/:filename', async c => {
     const obj = await runTask(laika.storage.getObject(`public/uploads/${c.req.param('filename')}`));
     const bytes = Buffer.from(obj.content['data'] as string, 'base64');
     return new Response(bytes, { headers: { 'Content-Type': obj.content['mimeType'] as string } });
   });
   ```
   See `apps/starter-media-blog` for the complete pattern (includes `Cache-Control`,
   error handling, and `marked`-rendered markdown so `<img>` tags actually render).

---

## 5. Decision tree

> "I need to build X. Which starter should I copy?"

```
┌─ Building a public website? ─────────────────────────────────────┐
│                                                                  │
│  React?           → starter-next-blog (App Router SSR)           │
│  Vue?             → starter-nuxt-blog                            │
│  Svelte?          → starter-sveltekit-blog                       │
│  Solid?           → starter-solid-start                          │
│  Qwik?            → starter-qwik-blog                            │
│  Astro?           → starter-astro-blog                           │
│  Eleventy/static? → starter-eleventy-jamstack                    │
│  TanStack Router? → starter-tanstack-blog                        │
│  Marko?           → starter-marko-blog                           │
│  Hypermedia/HTMX? → starter-htmx-hono                            │
│  Web Components?  → starter-lit-spa                              │
│  Just want SPA?   → starter-vite-vue-spa or starter-vite-solid-spa│
│  Need image/file uploads?  → starter-media-blog                  │
└──────────────────────────────────────────────────────────────────┘

┌─ Building a backend API (no public UI)? ─────────────────────────┐
│                                                                  │
│  Hono on Node?    → starter-hono-backend                          │
│  Express?         → starter-express-backend                       │
│  Fastify?         → starter-fastify-backend                       │
│  Koa?             → starter-koa-backend                           │
│  Bun runtime?     → starter-bun-backend                           │
│  Deno runtime?    → starter-deno-backend                          │
└──────────────────────────────────────────────────────────────────┘

┌─ Deploying to edge/serverless? ──────────────────────────────────┐
│                                                                  │
│  Cloudflare Workers? → starter-workers-r2 ✅                       │
│  AWS Lambda?         → starter-lambda-blog                        │
│  Vercel Edge?        → starter-vercel-edge 🟡 (PoC — storage gap)  │
│  Netlify Functions?  → starter-netlify-functions 🟡 (dev only)     │
└──────────────────────────────────────────────────────────────────┘
```

If your target isn't listed: pick the closest preset and copy the shape. `starter-hono-backend` is
the canonical "minimal Node example"; `starter-workers-r2` is the canonical "minimal edge example".

---

## 6. What to do when this guide is wrong

This file lives in the repo because LaikaCMS evolves. If you (LLM or human) followed an instruction
here and it didn't work — **update this file in the same PR**. The doc-improvement loop that
maintains the starters also maintains this guide. See `docs/starters.md` for the "continuous
documentation audit" philosophy.
