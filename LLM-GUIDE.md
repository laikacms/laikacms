# LaikaCMS for LLMs and Agents

A condensed entry point for anyone (LLM or human) bootstrapping with LaikaCMS in under five minutes.
If you're a coding agent dropped into a repo that wants to use LaikaCMS, **read this first**, then
[`docs/starters.md`](./docs/starters.md), then the specific docs you need.

> **Note (June 2026):** the `starter-*` reference apps and most adapter packages were moved out of
> this monorepo (see [`docs/restructure-2026-06.md`](./docs/restructure-2026-06.md)). The
> `starter-…` names below still tell you which **pattern** to use; the directories themselves now
> live in separate repositories (locations TBD).

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

The `@laikacms/decap` package gives you the primitives for each layer:

- **`decapApi(...)`** (`@laikacms/decap/decap-api`) — the Decap-compatible HTTP API over your repos.
  Returns `{ fetch, authenticateRequest }`; mount `.fetch` on a catch-all route.
- **`createLaikaBackend()`** (`@laikacms/decap/decap-cms-backend-laika`) — the Decap CMS backend the
  admin UI registers to talk to that API.
- **`decapOauth2(...)`** (`@laikacms/decap/decap-oauth2`) — an optional PKCE OAuth2 server for
  production login.

For most apps: construct a `StorageRepository`, wrap it in the ContentBase document/asset repos,
pass them to `decapApi(...)`, and mount `.fetch` on a catch-all route.

---

## 2. Five tasks with code

### a) Spin up a Node.js backend (Express/Hono/Fastify/Koa/Bun/Deno)

```ts
import { decapApi } from '@laikacms/decap/decap-api';
import { ContentBaseAssetsRepository } from 'laikacms/assets/contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents/contentbase';
import { markdownSerializer } from 'laikacms/serializers/markdown';
import { FileSystemStorageRepository } from 'laikacms/storage/fs';
import { resolve } from 'node:path';

const storage = new FileSystemStorageRepository(
  resolve(process.cwd(), 'content'),
  { md: markdownSerializer },
  'md',
);
const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
const documents = new ContentBaseDocumentsRepository(storage, settings);
const assets = new ContentBaseAssetsRepository(storage, settings);

const laika = decapApi({
  documents,
  storage,
  assets,
  basePath: '/api/decap',
  authenticateAccessToken: yourValidator, // throw to reject; see task (e) for production auth
});

// Mount on every method at /api/decap/*:
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Serve the Decap CMS admin shell (loads Decap from CDN, registers the Laika backend):
app.get('/admin', c => c.html(ADMIN_HTML)); // see docs/decap-integration.md → "Serving the Decap admin shell"
```

> **Before any content operation: seed the Decap config into storage once.**
> `DecapContentBaseSettingsProvider` reads the Decap config object from `storage[configKey]` on
> every request. If the key is missing, every document and asset operation throws
> `"Decap config object not found at storage key 'config'"`. Run this once (setup script, migration,
> or first-boot handler):
>
> ```ts
> import { runTask } from 'laikacms/compat';
>
> await runTask(
>   storage.createOrUpdateObject({
>     key: 'config', // must match the `configKey` you passed to DecapContentBaseSettingsProvider
>     content: {
>       collections: [
>         {
>           name: 'posts',
>           label: 'Posts',
>           folder: 'posts',
>           create: true,
>           fields: [{ name: 'title', widget: 'string' }, { name: 'body', widget: 'markdown' }],
>         },
>       ],
>       media_folder: 'uploads',
>       public_folder: '/uploads',
>     },
>   }),
> );
> ```
>
> See
> [docs/decap-integration.md → "Seeding the server-side Decap config"](./docs/decap-integration.md#seeding-the-server-side-decap-config)
> for the full pattern (shared config constant, serializer requirements, server-vs-browser copies).

### b) Render content server-side in a framework page (Next/SvelteKit/Astro/Nuxt/Remix/etc.)

```ts
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
// Export the `documents` repo you built in task (a) and import it directly —
// `decapApi(...)` returns only { fetch, authenticateRequest }, so SSR reads use the repo.
import { documents } from '~/server/laika';

// List published posts in a folder:
const { items } = await collectStream(
  documents.listRecordSummaries({
    folder: 'posts',
    depth: 1,
    pagination: { page: 1, perPage: 100 }, // NOT { offset, limit }
    type: 'published',
  }),
);

// Read one published document by key:
try {
  const doc = await runTask(documents.getDocument('posts/hello-world'));
  const { title, body } = doc.content as { title?: string, body?: string };
} catch (err) {
  if (err instanceof NotFoundError) {
    /* render 404 */
  }
  throw err; // always re-throw unknown errors
}
```

### c) Deploy to Cloudflare Workers + R2

The same `decapApi(...)` wiring works on the edge — just swap `FileSystemStorageRepository` for an
edge-compatible repo such as `R2StorageRepository` (`node:fs` is unavailable in V8 isolates).

```ts
import { decapApi } from '@laikacms/decap/decap-api';
import { Hono } from 'hono';
import { ContentBaseAssetsRepository } from 'laikacms/assets/contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents/contentbase';
import { R2StorageRepository } from 'laikacms/storage/r2';

export interface Env {
  CONTENT: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

const makeLaika = (env: Env) => {
  const storage = new R2StorageRepository(/* … env.CONTENT … */);
  const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
  return decapApi({
    documents: new ContentBaseDocumentsRepository(storage, settings),
    storage,
    assets: new ContentBaseAssetsRepository(storage, settings),
    basePath: '/api/decap',
    authenticateAccessToken: yourValidator,
  });
};

app.all('/api/decap/*', c => makeLaika(c.env).fetch(c.req.raw));
app.get('/admin', c => c.html(ADMIN_HTML)); // see docs/decap-integration.md → "Serving the Decap admin shell"

export default app;
```

### d) Use the HTTP API from a SPA (Vue/Solid/Lit/React-SPA)

**Don't.** Use a sidecar Node/Workers backend that exposes `/api/posts` etc. as public endpoints
(reading the repo directly), and have the SPA `fetch('/api/posts')`. See
[docs/starters.md](./docs/starters.md) for the canonical sidecar pattern (starters were moved to
separate repos in the June 2026 restructure).

Why: the LaikaCMS HTTP API requires a Bearer token on every endpoint except `/health`. SPAs can't
safely hold one.

### e) Add real auth (production)

Pass a real `authenticateAccessToken` validator to `decapApi(...)`. It receives the Bearer token on
every request and must return a `User` (throw to reject — `decapApi` turns thrown errors into a
401).

```ts
import { decapApi } from '@laikacms/decap/decap-api';
import { jwtVerify, SignJWT } from 'jose';

// 1. Issue a JWT after your login form:
const token = await new SignJWT({ email: user.email, name: user.name })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(user.id)
  .setExpirationTime('8h')
  .sign(secret);

// 2. Hand that token to the admin shell so Decap sends it as the Bearer token
//    (inject it into the HTML you serve at /admin behind your login guard).

// 3. Validate it on every API request:
const laika = decapApi({
  documents,
  storage,
  assets,
  basePath: '/api/decap',
  async authenticateAccessToken(token) {
    const { payload } = await jwtVerify(token, secret);
    return {
      id: payload.sub as string,
      email: payload.email as string,
      name: payload.name as string,
    };
  },
});
```

For a full self-contained login server (email/password, passkey, TOTP) use the `decapOauth2(...)`
PKCE server from `@laikacms/decap/decap-oauth2` — see
[docs/decap-integration.md → "Production auth with decap-oauth2"](./docs/decap-integration.md#production-auth-with-decap-oauth2).

---

## 3. Choosing a storage backend

`decapApi(...)` is runtime-agnostic — the only thing that changes between Node and the edge is which
`StorageRepository` you construct:

| Storage repo                  | Subpath                    | Runtime                            |
| ----------------------------- | -------------------------- | ---------------------------------- |
| `FileSystemStorageRepository` | `laikacms/storage/fs`      | Node, Bun, Deno (needs `node:fs`)  |
| `R2StorageRepository`         | `laikacms/storage/r2`      | V8 isolates (Workers, Vercel Edge) |
| `DrizzleStorageRepository`    | `laikacms/storage/drizzle` | Any SQL DB via Drizzle ORM         |
| `WebDavStorageRepository`     | `laikacms/storage/webdav`  | Any RFC 4918 WebDAV server         |

Wrap the repo in `ContentBaseDocumentsRepository` / `ContentBaseAssetsRepository`, pass them to
`decapApi(...)`, and mount `.fetch` from your framework's catch-all route. `decapApi(...)` returns
`{ fetch, authenticateRequest }`. For server-side render reads, call the `documents` / `assets` /
`storage` repos directly to **bypass HTTP auth** — server-internal reads don't need a token.

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

3. **`@laikacms/storage/fs` is NOT a separate package on npm.**
   - It's a subpath export of `laikacms`. Use
     `import { FileSystemStorageRepository } from
     'laikacms/storage/fs'`. Same for
     `storage-api`, `documents-api`, `storage-serializers-*`, etc.
   - The Decap backend lives at `@laikacms/decap/decap-cms-backend-laika` — a subpath of
     `@laikacms/decap`, NOT a separate `@laikacms/decap-cms-backend-laika` package.

4. **`FileSystemStorageRepository` is Node-only.** It needs `node:fs` and a writable local
   filesystem, so it can't run in Workers/edge code. On the edge, construct an edge-compatible
   `StorageRepository` such as `R2StorageRepository` instead and pass it to the same
   `decapApi(...)`.

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
     `+handler.ts`, Astro `is:inline`). Serve a small HTML string that loads Decap from CDN and
     registers `createLaikaBackend()` — see
     [docs/decap-integration.md → "Serving the Decap admin shell"](./docs/decap-integration.md#serving-the-decap-admin-shell).

7. **`workspace:*` for internal deps; `catalog:*` for shared external deps.** Use `workspace:*` for
   any `@laikacms/*` package reference within the monorepo, and `catalog:*` for shared external
   dependencies defined in the root `pnpm-workspace.yaml` catalog.

8. **`api_root` (not `api_url`) in the Decap backend config.** The Laika backend constructor reads
   `config.backend.api_root` (with `api_url` accepted as a deprecated alias). Without it, all Decap
   admin API calls resolve to the site root and silently 404.
   - In your Decap config's `backend` key, set `api_root` to the path you mounted `decapApi(...)` on
     (e.g. `'/api/decap'`).
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

12. **Packages need a `dist/` before downstream packages can type-check.** The monorepo has three
    core packages (`laikacms`, `@laikacms/decap`, `@laikacms/github`). If you run
    `pnpm --filter <package> exec tsc --noEmit` directly and get
    `Cannot find module '@laikacms/...'`, build the upstream package first:
    ```
    pnpm --filter @laikacms/decap build
    ```
    The correct way to typecheck in CI or as a one-shot command is the root-level turbo task, which
    builds upstream dependencies automatically:
    ```
    pnpm run typecheck              # builds all packages, then type-checks everything
    pnpm run typecheck --filter ... # scoped to specific packages
    ```

13. **Seed the Decap config object before the first content operation.** If you use
    `DecapContentBaseSettingsProvider`, it reads your Decap config from `storage[configKey]` on
    every request. On an empty storage directory the key does not exist, and every call to
    `documents.*` or `assets.*` throws `"Decap config object not found at storage key 'config'"`.
    Seed it once:
    ```ts
    import { runTask } from 'laikacms/compat';
    await runTask(storage.createOrUpdateObject({ key: 'config', content: yourDecapConfig }));
    ```
    The serializer registry must support structured data — `markdownSerializer`, `yamlSerializer`,
    or `jsonSerializer` all work; `rawSerializer` silently drops the `collections` field. See the
    callout in task (a) above and
    [docs/decap-integration.md → "Seeding the server-side Decap config"](./docs/decap-integration.md#seeding-the-server-side-decap-config).

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

If your target isn't listed: pick the closest pattern and copy the shape. `starter-hono-backend` is
the canonical "minimal Node example"; `starter-workers-r2` is the canonical "minimal edge example".

---

## 6. What to do when this guide is wrong

This file lives in the repo because LaikaCMS evolves. If you (LLM or human) followed an instruction
here and it didn't work — **update this file in the same PR**. The doc-improvement loop that
maintains the starters also maintains this guide. See `docs/starters.md` for the "continuous
documentation audit" philosophy.
