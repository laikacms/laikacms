# LaikaCMS for LLMs and Agents

A condensed entry point for anyone (LLM or human) bootstrapping with LaikaCMS in under five minutes.
If you're a coding agent dropped into a repo that wants to use LaikaCMS, **read this first**, then
[`docs/starters.md`](./docs/starters.md), then the specific docs you need.

> **Note (June 2026):** the `starter-*` reference apps and most adapter packages were moved out of
> this monorepo (see [`docs/restructure-2026-06.md`](./docs/restructure-2026-06.md)). The
> `starter-…` names below still tell you which **preset and pattern** to use; the directories
> themselves now live in separate repositories (locations TBD).

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
  laika.documents.listRecordSummaries({
    folder: 'posts',
    depth: 1,
    pagination: { page: 1, perPage: 100 }, // NOT { offset, limit }
    type: 'published',
  }),
);

// Read one published document by key:
try {
  const doc = await runTask(laika.documents.getDocument('posts/hello-world'));
  const { title, body } = doc.content as { title?: string, body?: string };
} catch (err) {
  if (err instanceof NotFoundError) {
    /* render 404 */
  }
  throw err; // always re-throw unknown errors
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
import { jwtVerify, SignJWT } from 'jose';

// 1. Issue a JWT after your login form:
const token = await new SignJWT({ email: user.email, name: user.name })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(user.id)
  .setExpirationTime('8h')
  .sign(secret);

// 2. Inject it into the admin shell server-side (no CDN dev-token import):
app.get('/admin', requireLogin, async c => {
  const token = getCookie(c, 'session')!;
  return c.html(decapAdminHtml({ devToken: token }));
});

// 3. Validate it on every API request:
createEmbeddedLaika({
  // ... contentDir, decapConfig, basePath ...
  auth: {
    mode: 'custom',
    async authenticateAccessToken(token) {
      const { payload } = await jwtVerify(token, secret);
      return { id: payload.sub, email: payload.email, name: payload.name };
    },
  },
});
```

The `devToken` option to `decapAdminHtml()` replaces the hardcoded `DEFAULT_DEV_TOKEN` CDN import
with a server-side token injection. See `apps/starter-jose-auth` for the full login→JWT→admin flow.

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
   or use `@laikacms/github/storage-gh` (GitHub-backed):
   ```ts
   import { GithubStorageRepository } from '@laikacms/github/storage-gh';
   ```

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

8. **`api_root` (not `api_url`) in the Decap backend config.** The Laika backend constructor reads
   `config.backend.api_root` (with `api_url` accepted as a deprecated alias). Without it, all Decap
   admin API calls resolve to the site root and silently 404.
   - When using `decapAdminHtml()` + `minimalBlogConfig()`, `api_root: '/api/decap'` is included in
     the default backend config automatically since v0.x — you only need to pass it explicitly when
     overriding the `backend` key.
   - When wiring your own `CMS.init()` (next-blog / astro-blog pattern), use:
     `backend: { name: 'laika', api_root: '/api/decap' }`
   - The serializer registry needs all four types: `{ md, yaml, yml, json, raw }`. If you only
     register `md`, saving YAML or JSON files silently fails.

9. **Effect Platform 4.x moved HTTP types into `effect/unstable/http/*`.** If you're using
   `@effect/platform-node`, import from `effect/unstable/http/HttpRouter`, not
   `@effect/platform/HttpRouter`. The platform-node package only exports the Node.js server
   primitives (`NodeHttpServer`, `NodeRuntime`). Additionally:
   - `Effect.catchAll` → use `Effect.result()` to convert failures to `Result<A, E>`, then branch on
     `Result.isSuccess` / `Result.isFailure`. The `.success` field holds the value on success.
   - `HttpRouter.add(method, path, handler)` at the **module** level returns a `Layer` (not an
     `Effect`). Compose route layers with `Layer.mergeAll` and serve via
     `HttpRouter.serve(appLayer)`.
   - Bridge `laika.fetch` into Effect HTTP: `yield* HttpServerRequest.toWeb(request)` gives a WHATWG
     `Request`; wrap the result with `HttpServerResponse.fromWeb(response)`.

10. **Pagination shape is `{ page, perPage }`, not `{ offset, limit }`.** Both `listRecordSummaries`
    and `listRecords` exist on `DocumentsRepository`:
    - `listRecordSummaries({ pagination: { page: 1, perPage: 100 } })` — lightweight summaries,
      prefer this for listing/index pages.
    - `listRecords({ pagination: { page: 1, perPage: 100 } })` — full record bodies, use when you
      need the complete content of every record in one pass.

11. **`NotFoundError` must be imported from `laikacms/core` and re-thrown.** A bare `catch {}`
    swallows all errors. Always check:
    ```ts
    catch (err) {
      if (err instanceof NotFoundError) return c.notFound();
      throw err;
    }
    ```

12. **Integration packages need a `dist/` before their starters can be type-checked.** Only a
    handful of `packages/integrations/*` have pre-built dists committed to the repo. If you run
    `pnpm --filter @laikacms/starter-foo exec tsc --noEmit` directly and get
    `Cannot find module '@laikacms/foo/storage-bar'`, build the integration first:
    ```
    pnpm --filter @laikacms/foo build
    ```
    The correct way to typecheck in CI or as a one-shot command is the root-level turbo task, which
    builds upstream dependencies automatically:
    ```
    pnpm run typecheck              # builds all integration packages, then checks all starters
    pnpm run typecheck --filter ... # scoped to specific packages
    ```

---

## 5. Decision tree

> "I need to build X. Which starter should I copy?"

```
┌─ Building a public website? ─────────────────────────────────────┐
│                                                                  │
│  React?           → starter-next-blog (App Router SSR)            │
│  Vue?             → starter-nuxt-blog                             │
│  Svelte?          → starter-sveltekit-blog                        │
│  Solid?           → starter-solid-start                           │
│  Qwik?            → starter-qwik-blog                             │
│  Astro?           → starter-astro-blog                            │
│  Eleventy/static? → starter-eleventy-jamstack                     │
│  TanStack Router? → starter-tanstack-blog                         │
│  Marko?           → starter-marko-blog                            │
│  Hypermedia/HTMX? → starter-htmx-hono                             │
│  Web Components?  → starter-lit-spa                               │
│  Just want SPA?   → starter-vite-vue-spa or starter-vite-solid-spa│
└──────────────────────────────────────────────────────────────────┘

┌─ Building a backend API (no public UI)? ─────────────────────────┐
│                                                                  │
│  Hono on Node?        → starter-hono-backend                      │
│  Express?             → starter-express-backend                   │
│  Fastify?             → starter-fastify-backend                   │
│  Koa?                 → starter-koa-backend                       │
│  Bun runtime?         → starter-bun-backend                       │
│  Deno runtime?        → starter-deno-backend                      │
│  Effect Platform?     → starter-effect-platform-blog              │
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
