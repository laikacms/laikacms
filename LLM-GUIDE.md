# LaikaCMS for LLMs and Agents

A condensed entry point for anyone (LLM or human) bootstrapping with LaikaCMS in under five minutes.
If you're a coding agent dropped into a repo that wants to use LaikaCMS, **read this first**, then
[`docs/contributing/starters.md`](./docs/contributing/starters.md), then the specific docs you need.

> **Note (June 2026):** the `starter-*` reference apps and most adapter packages were moved out of
> this monorepo (see
> [`docs/contributing/restructure-2026-06.md`](./docs/contributing/restructure-2026-06.md)). The
> `starter-…` names below still tell you which **pattern** to use; the directories themselves now
> live in separate repositories (locations TBD).

---

## 1. The two-minute mental model

LaikaCMS is **three things stacked**:

```
┌─────────────────────────────────────────────────────────┐
│   HTTP API   (JSON:API)  — what Decap / clients call    │
│   ─ buildJsonApi / laikaApi — web-standard fetch        │
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

The `@laikacms/server` package gives you the primitives for each layer:

- **`laikaApi(...)`** (`@laikacms/server/api`) — the Decap-compatible HTTP API over your repos.
  Returns `{ fetch, authenticateRequest }`; mount `.fetch` on a catch-all route.
- **`createLaikaBackend()`** (`@laikacms/decap-cms/backends/laika`) — the Decap CMS backend the
  admin UI registers to talk to that API.
- **`laikaOauth2(...)`** (`@laikacms/server/oauth2`) — an optional PKCE OAuth2 server for production
  login.

For most apps: construct a `StorageRepository`, wrap it in the ContentBase document/asset repos,
pass them to `laikaApi(...)`, and mount `.fetch` on a catch-all route.

---

## 2. Five tasks with code

### a) Spin up a Node.js backend (Express/Hono/Fastify/Koa/Bun/Deno)

```ts
import { serveStatic } from '@hono/node-server/serve-static';
import { laikaApi } from '@laikacms/server/api';
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { resolve } from 'node:path';

const storage = new FileSystemStorageRepository(
  resolve(process.cwd(), 'content'),
  { md: markdownSerializer },
  'md',
);
const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
const documents = new ContentBaseDocumentsRepository(storage, settings);
const assets = new ContentBaseAssetsRepository(storage, settings);

const laika = laikaApi({
  documents,
  storage,
  assets,
  basePath: '/api/decap',
  authenticateAccessToken: yourValidator, // throw to reject; see task (e) for production auth
});

// Serve the Decap CMS admin bundle (built by esbuild — see docs/guides/decap/admin-shell.md → "Serving the Decap admin shell"):
app.use('/admin/*', serveStatic({ root: './admin' }));

// Mount on every method at /api/decap/*:
app.all('/api/decap/*', c => laika.fetch(c.req.raw));
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
> [docs/guides/decap/standalone-worker.md → "Seeding the server-side Decap config"](./docs/guides/decap/standalone-worker.md#seeding-the-server-side-decap-config)
> for the full pattern (shared config constant, serializer requirements, server-vs-browser copies).

### b) Render content server-side in a framework page (Next/SvelteKit/Astro/Nuxt/Remix/etc.)

```ts
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
// Export the `documents` repo you built in task (a) and import it directly —
// `laikaApi(...)` returns only { fetch, authenticateRequest }, so SSR reads use the repo.
import { documents } from '~/server/laika';

// List published posts in a folder:
const { items } = await collectStream(
  documents.listRecordSummaries({
    folder: 'posts',
    depth: 1,
    pagination: { page: 1, perPage: 100 }, // or { offset: 0, limit: 100 } — both styles work
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

The same `laikaApi(...)` wiring works on the edge — just swap `FileSystemStorageRepository` for an
edge-compatible repo such as `R2StorageRepository` (`node:fs` is unavailable in V8 isolates).

```ts
import { laikaApi } from '@laikacms/server/api';
import { Hono } from 'hono';
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { R2StorageRepository } from 'laikacms/storage-r2';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

export interface Env {
  CONTENT: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

const makeLaika = (env: Env) => {
  const storage = new R2StorageRepository(env.CONTENT, { md: markdownSerializer }, 'md');
  const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
  return laikaApi({
    documents: new ContentBaseDocumentsRepository(storage, settings),
    storage,
    assets: new ContentBaseAssetsRepository(storage, settings),
    basePath: '/api/decap',
    authenticateAccessToken: yourValidator,
  });
};

app.all('/api/decap/*', c => makeLaika(c.env).fetch(c.req.raw));
// Serve the Decap CMS admin bundle: build admin/ with esbuild, then declare
// `[assets] directory = "./admin"` in wrangler.toml — Workers Assets serve /admin/* automatically.
// See docs/guides/decap/admin-shell.md → "Serving the Decap admin shell"

export default app;
```

### d) Use the HTTP API from a SPA (Vue/Solid/Lit/React-SPA)

**Don't.** Use a sidecar Node/Workers backend that exposes `/api/posts` etc. as public endpoints
(reading the repo directly), and have the SPA `fetch('/api/posts')`. See
[docs/contributing/starters.md](./docs/contributing/starters.md) for the canonical sidecar pattern
(starters were moved to separate repos in the June 2026 restructure).

Why: the LaikaCMS HTTP API requires a Bearer token on every endpoint except `/health`. SPAs can't
safely hold one.

### e) Add real auth (production)

Pass a real `authenticateAccessToken` validator to `laikaApi(...)`. It receives the Bearer token on
every request and must return a `User` (throw to reject — `laikaApi` turns thrown errors into a
401).

```ts
import { laikaApi } from '@laikacms/server/api';
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
const laika = laikaApi({
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

For a full self-contained login server (email/password, passkey, TOTP) use the `laikaOauth2(...)`
PKCE server from `@laikacms/server/oauth2` — see
[docs/guides/decap/auth.md → "Production auth with decap-oauth2"](./docs/guides/decap/auth.md#production-auth-with-decap-oauth2).

---

## 3. Choosing a storage backend

`laikaApi(...)` is runtime-agnostic — the only thing that changes between Node and the edge is which
`StorageRepository` you construct:

| Storage repo                  | Subpath                          | Runtime                                          |
| ----------------------------- | -------------------------------- | ------------------------------------------------ |
| `FileSystemStorageRepository` | `laikacms/storage-fs`            | Node, Bun, Deno (needs `node:fs`)                |
| `R2StorageRepository`         | `laikacms/storage-r2`            | V8 isolates (Workers, Vercel Edge)               |
| `DrizzleStorageRepository`    | `laikacms/storage-drizzle`       | Any SQL DB via Drizzle ORM                       |
| `WebDavStorageRepository`     | `laikacms/storage-webdav`        | Any RFC 4918 WebDAV server                       |
| `GithubStorageRepository`     | `@laikacms/github/storage-gh`    | Runtime-agnostic (`fetch`-only); GitHub repos    |
| `GitlabStorageRepository`     | `@laikacms/gitlab/storage-gl`    | Runtime-agnostic (`fetch`-only); GitLab repos    |
| `BitbucketStorageRepository`  | `@laikacms/bitbucket/storage-bb` | Runtime-agnostic (`fetch`-only); Bitbucket repos |

Wrap the repo in `ContentBaseDocumentsRepository` / `ContentBaseAssetsRepository`, pass them to
`laikaApi(...)`, and mount `.fetch` from your framework's catch-all route. `laikaApi(...)` returns
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

3. **`laikacms/storage-fs` is NOT a separate package on npm.**
   - It's a subpath export of `laikacms`. Use
     `import { FileSystemStorageRepository } from
     'laikacms/storage-fs'`. Same for
     `laikacms/storage-api`, `laikacms/documents-api`, `laikacms/storage-serializers-*`, etc.
   - The Decap backend lives at `@laikacms/decap-cms/backends/laika` — a subpath of
     `@laikacms/server`. Import `createLaikaBackend` from there.

4. **`FileSystemStorageRepository` is Node-only.** It needs `node:fs` and a writable local
   filesystem, so it can't run in Workers/edge code. On the edge, construct an edge-compatible
   `StorageRepository` such as `R2StorageRepository` instead and pass it to the same
   `laikaApi(...)`.

5. **Edge-compatible storage options: R2 and the git-backed repos.** `R2StorageRepository`,
   `GithubStorageRepository`, `GitlabStorageRepository`, and `BitbucketStorageRepository` are all
   valid in V8 isolates and any `fetch`-only edge runtime. Vercel Blob, Netlify Blobs, Deno KV, and
   Bun S3 don't have first-party adapters yet — for those platforms write a small
   `StorageRepository` adapter or use one of the git-backed repos:
   ```ts
   import { BitbucketStorageRepository } from '@laikacms/bitbucket/storage-bb';
   import { GithubStorageRepository } from '@laikacms/github/storage-gh';
   import { GitlabStorageRepository } from '@laikacms/gitlab/storage-gl';
   ```

6. **Hide the Decap admin shell from your framework's hydration.** SSR frameworks hydrate the whole
   `<html>`. Decap also expects to own it. Pick one of:
   - Static file in `public/admin.html` (TanStack, Nuxt, Remix, SolidStart) — cleanest.
   - Iframe with `srcDoc` (Next App Router).
   - Inline server-rendered HTML response from a non-page route (SvelteKit `+server.ts`, Marko
     `+handler.ts`, Astro `is:inline`). Serve a small HTML string that loads Decap from CDN and
     registers `createLaikaBackend()` — see
     [docs/guides/decap/admin-shell.md → "Serving the Decap admin shell"](./docs/guides/decap/admin-shell.md#serving-the-decap-admin-shell).

7. **`workspace:*` for internal deps; `catalog:*` for shared external deps.** Use `workspace:*` for
   any `@laikacms/*` package reference within the monorepo, and `catalog:*` for shared external
   dependencies defined in the root `pnpm-workspace.yaml` catalog.

8. **`api_root` (not `api_url`) in the Decap backend config.** The Laika backend constructor reads
   `config.backend.api_root` (with `api_url` accepted as a deprecated alias). Without it, all Decap
   admin API calls resolve to the site root and silently 404.
   - In your Decap config's `backend` key, set `api_root` to the path you mounted `laikaApi(...)` on
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

10. **Both `{ page, perPage }` and `{ offset, limit }` pagination shapes are valid.** The
    `getCapabilities()` response tells you which styles a given backend supports
    (`capabilities.pagination.styles.offset` / `.page` / `.cursor`). Most backends support both
    offset and page styles; cursor is backend-specific. Both `listRecordSummaries` and `listRecords`
    exist on `DocumentsRepository`:
    - `listRecordSummaries({ pagination: { page: 1, perPage: 100 } })` — lightweight summaries,
      prefer this for listing/index pages.
    - `listRecords({ pagination: { offset: 0, limit: 100 } })` — full record bodies with
      offset-based pagination, use when you need the complete content of every record in one pass.

11. **`NotFoundError` must be imported from `laikacms/core` and re-thrown.** A bare `catch {}`
    swallows all errors. Always check:
    ```ts
    catch (err) {
      if (err instanceof NotFoundError) return c.notFound();
      throw err;
    }
    ```

12. **Packages need a `dist/` before downstream packages can type-check.** The monorepo has two core
    packages (`laikacms`, `@laikacms/server`). If you run
    `pnpm --filter <package> exec tsc --noEmit` directly and get
    `Cannot find module '@laikacms/...'`, build the upstream package first:
    ```
    pnpm --filter @laikacms/server build
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
    [docs/guides/decap/standalone-worker.md → "Seeding the server-side Decap config"](./docs/guides/decap/standalone-worker.md#seeding-the-server-side-decap-config).

14. **`ContentBaseDocumentsRepository` injects a `language` field into every stored content
    object.** The implementation co-locates the document language with its content in storage so
    reads can recover it without a separate metadata file. When i18n is not configured, Decap sends
    `language: "und"` (BCP 47 "undetermined"), so every saved `.json` file ends up with:
    ```json
    { "title": "My post", "body": "...", "language": "und" }
    ```
    This field will NOT be declared in your Decap `fields:` list — it appears alongside your data as
    a LaikaCMS internal. Filter it out when reading content files directly for rendering:
    ```ts
    const { language: _, ...content } = doc.content; // strip before using
    ```
    If you configure i18n, the value will be the active locale rather than `"und"`.

---

## 5. Decision tree

> "I need to build X. Which pattern should I use?"

The `starter-*` names below identify the **pattern**. The starter directories themselves were moved
to separate repos in June 2026 (locations TBD — see the note at the top of this file). For the two
canonical starting points, use the in-repo quickstart guides directly:

- **Minimal Node example** →
  [docs/guides/decap/quickstart-fs.md](./docs/guides/decap/quickstart-fs.md)
  (`FileSystemStorageRepository` + Hono + Decap admin shell, running locally)
- **Minimal edge example** →
  [docs/guides/decap/standalone-worker.md](./docs/guides/decap/standalone-worker.md)
  (`R2StorageRepository` + Hono + Cloudflare Workers Assets)
- **Inline wiring code** → sections 2a (Node) and 2c (Workers/R2) above have copy-paste-ready code

```
┌─ Building a public website? ─────────────────────────────────────┐
│                                                                  │
│  React?           → starter-next-blog pattern (App Router SSR)    │
│  Vue?             → starter-nuxt-blog pattern                     │
│  Svelte?          → starter-sveltekit-blog pattern                │
│  Solid?           → starter-solid-start pattern                   │
│  Qwik?            → starter-qwik-blog pattern                     │
│  Astro?           → starter-astro-blog pattern                    │
│  Eleventy/static? → starter-eleventy-jamstack pattern             │
│  TanStack Router? → starter-tanstack-blog pattern                 │
│  Marko?           → starter-marko-blog pattern                    │
│  Hypermedia/HTMX? → starter-htmx-hono pattern                     │
│  Web Components?  → starter-lit-spa pattern                       │
│  Just want SPA?   → starter-vite-vue-spa or vite-solid-spa pattern│
└──────────────────────────────────────────────────────────────────┘

┌─ Building a backend API (no public UI)? ─────────────────────────┐
│                                                                  │
│  Hono on Node?        → starter-hono-backend pattern              │
│  Express?             → starter-express-backend pattern           │
│  Fastify?             → starter-fastify-backend pattern           │
│  Koa?                 → starter-koa-backend pattern               │
│  Bun runtime?         → starter-bun-backend pattern               │
│  Deno runtime?        → starter-deno-backend pattern              │
│  Effect Platform?     → starter-effect-platform-blog pattern      │
└──────────────────────────────────────────────────────────────────┘

┌─ Deploying to edge/serverless? ──────────────────────────────────┐
│                                                                  │
│  Cloudflare Workers? → quickstart-fs.md§c / standalone-worker.md  │
│  AWS Lambda?         → starter-lambda-blog pattern               │
│  Vercel Edge?        → starter-vercel-edge pattern (PoC)         │
│  Netlify Functions?  → starter-netlify-functions pattern (dev)   │
└──────────────────────────────────────────────────────────────────┘
```

If your target isn't listed: pick the closest pattern and copy the wiring from sections 2a–2c above,
or from the `quickstart-fs.md` / `standalone-worker.md` guides in `docs/guides/decap/`.

---

## 6. What to do when this guide is wrong

This file lives in the repo because LaikaCMS evolves. If you (LLM or human) followed an instruction
here and it didn't work — **update this file in the same PR**. The doc-improvement loop that
maintains the starters also maintains this guide. See `docs/contributing/starters.md` for the
"continuous documentation audit" philosophy.
