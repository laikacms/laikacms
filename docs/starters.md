# Starter templates

Each starter lives under `apps/starter-<framework>-<flavor>/` and is a **reference app you can copy
or run directly**. Goals:

1. Show how LaikaCMS is wired into a given frontend framework with the **minimum** scaffolding.
2. Use the **embedded preset** (`@laikacms/decap-integrations/embedded`) where possible — it
   composes the right defaults so the starter is short.
3. Stay **self-hosted by default** (FileSystem storage) so anyone can run it without a cloud
   account.
4. Be **LLM-friendly**: file layout follows the framework's conventions, imports use real package
   names, and there is one obvious place to find each piece.

## Current starters

| Path                                                                   | Framework                                                                                                                | Storage                           | Admin                                                     | Status                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| [`apps/starter-next-blog`](../apps/starter-next-blog/)                 | Next.js 15 (App Router)                                                                                                  | FileSystem                        | Decap, embedded                                           | ✅ Working                                                       |
| [`apps/starter-astro-blog`](../apps/starter-astro-blog/)               | Astro 5 (`output: 'server'`, `@astrojs/node`)                                                                            | FileSystem                        | Decap, embedded                                           | ✅ Working                                                       |
| [`apps/starter-sveltekit-blog`](../apps/starter-sveltekit-blog/)       | SvelteKit 2 + Svelte 5 + `@sveltejs/adapter-node`                                                                        | FileSystem                        | Decap, embedded                                           | ✅ Working                                                       |
| [`apps/starter-hono-backend`](../apps/starter-hono-backend/)           | Hono + Node (headless backend, no frontend)                                                                              | FileSystem                        | Decap, embedded                                           | ✅ Working                                                       |
| [`apps/starter-nuxt-blog`](../apps/starter-nuxt-blog/)                 | Nuxt 3 + Vue 3 + Nitro                                                                                                   | FileSystem                        | Decap, embedded                                           | ✅ Working                                                       |
| [`apps/starter-tanstack-blog`](../apps/starter-tanstack-blog/)         | TanStack Start (SSR) + TanStack Router                                                                                   | FileSystem                        | Decap, embedded                                           | ✅ Working                                                       |
| [`apps/starter-eleventy-jamstack`](../apps/starter-eleventy-jamstack/) | Eleventy 3 (static build) + sidecar Hono admin                                                                           | FileSystem                        | Decap, sidecar server                                     | ✅ Working                                                       |
| [`apps/starter-workers-r2`](../apps/starter-workers-r2/)               | Cloudflare Workers + Hono                                                                                                | **R2**                            | Decap, embedded                                           | ✅ Working                                                       |
| [`apps/starter-remix-blog`](../apps/starter-remix-blog/)               | React Router v7 (Remix framework mode)                                                                                   | FileSystem                        | Decap, embedded                                           | ✅ Working                                                       |
| [`apps/starter-bun-backend`](../apps/starter-bun-backend/)             | **Bun** runtime + native `Bun.serve()`                                                                                   | FileSystem                        | Decap, embedded                                           | ✅ Working                                                       |
| [`apps/starter-express-backend`](../apps/starter-express-backend/)     | Express 4 + web-standard adapter                                                                                         | FileSystem                        | Decap, embedded                                           | ✅ Working                                                       |
| [`apps/starter-fastify-backend`](../apps/starter-fastify-backend/)     | Fastify 5 + web-standard adapter                                                                                         | FileSystem                        | Decap, embedded                                           | ✅ Working                                                       |
| [`apps/starter-vite-vue-spa`](../apps/starter-vite-vue-spa/)           | Vue 3 SPA (Vite) + sidecar Hono backend                                                                                  | FileSystem                        | Decap, sidecar server                                     | ✅ Working                                                       |
| [`apps/starter-koa-backend`](../apps/starter-koa-backend/)             | Koa 2 + `@koa/router` + web-standard adapter                                                                             | FileSystem                        | Decap, embedded                                           | ✅ Working                                                       |
| [`apps/starter-vite-solid-spa`](../apps/starter-vite-solid-spa/)       | Solid.js SPA (Vite) + sidecar Hono backend                                                                               | FileSystem                        | Decap, sidecar server                                     | ✅ Working                                                       |
| [`apps/starter-deno-backend`](../apps/starter-deno-backend/)           | **Deno 2** + native `Deno.serve()` (nodeModulesDir auto)                                                                 | FileSystem                        | Decap, embedded                                           | 🟡 Scaffolded (Deno not on dev box)                              |
| [`apps/starter-qwik-blog`](../apps/starter-qwik-blog/)                 | Qwik City (resumability)                                                                                                 | FileSystem                        | Decap, embedded                                           | ✅ Working                                                       |
| [`apps/starter-lit-spa`](../apps/starter-lit-spa/)                     | Lit 3 Web Components (framework-less) + sidecar Hono                                                                     | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-htmx-hono`](../apps/starter-htmx-hono/)                 | Server-rendered HTML (`hono/jsx`) + HTMX (hypermedia)                                                                    | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-marko-blog`](../apps/starter-marko-blog/)               | Marko 5 + `@marko/run` (streaming SSR, tag syntax)                                                                       | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-vercel-edge`](../apps/starter-vercel-edge/)             | Vercel Edge Functions + Hono (R2-shim over Vercel Blob)                                                                  | **Vercel Blob** (partial)         | Decap via `decapAdminHtml()`                              | 🟡 PoC — see README                                              |
| [`apps/starter-solid-start`](../apps/starter-solid-start/)             | SolidStart SSR (Vinxi + Nitro)                                                                                           | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-netlify-functions`](../apps/starter-netlify-functions/) | Netlify Functions v2 (Node) + Hono                                                                                       | **ephemeral /tmp** (Blobs TBD)    | Decap via `decapAdminHtml()`                              | 🟡 Dev OK; needs Netlify Blobs adapter for prod                  |
| [`apps/starter-react-native-expo`](../apps/starter-react-native-expo/) | React Native + Expo Router (mobile, HTTP-only client)                                                                    | n/a — consumes a backend          | n/a (use a backend's admin)                               | ✅ Scaffolded                                                    |
| [`apps/starter-drizzle-sqlite`](../apps/starter-drizzle-sqlite/)       | Hono + `DrizzleStorageRepository` over libsql/SQLite (Turso-ready, uses `createCustomLaika`)                             | **SQL**                           | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-github-storage`](../apps/starter-github-storage/)       | Hono + `GithubStorageRepository` (content lives in a Git repo, every edit is a commit)                                   | **GitHub**                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-hattip`](../apps/starter-hattip/)                       | Hattip universal handler — one `(ctx) => Response`, swap adapter for any runtime                                         | FileSystem (swap for any storage) | Decap via `decapAdminHtml()`                              | ✅ Working (Node adapter)                                        |
| [`apps/starter-cli-tool`](../apps/starter-cli-tool/)                   | Node.js CLI — read/write content from the shell (CI, scripts, migrations)                                                | FileSystem                        | n/a (script tool)                                         | ✅ Working                                                       |
| [`apps/starter-next-pages`](../apps/starter-next-pages/)               | Next.js 15 — **Pages Router** (legacy) with `getServerSideProps`                                                         | FileSystem                        | Decap via `decapAdminHtml()` (iframed)                    | ✅ Working                                                       |
| [`apps/starter-s3-storage`](../apps/starter-s3-storage/)               | Hono + `@aws-sdk/client-s3` over the new first-party **`laikacms/storage-s3`** adapter (AWS S3 / MinIO / B2 / R2-via-S3) | **S3-compatible** (full)          | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-cloudflare-pages`](../apps/starter-cloudflare-pages/)   | Cloudflare Pages + Pages Functions (static CDN + V8 isolates)                                                            | **R2**                            | Decap via `decapAdminHtml()` (served by Function)         | ✅ Working                                                       |
| [`apps/starter-graphql`](../apps/starter-graphql/)                     | graphql-yoga GraphQL API alongside JSON:API (Hono host)                                                                  | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-trpc`](../apps/starter-trpc/)                           | tRPC v11 + `@hono/trpc-server` — type-safe RPC alongside JSON:API                                                        | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-node-http`](../apps/starter-node-http/)                 | Zero-deps `node:http` only, ~80 LOC — pedagogical "minimum viable"                                                       | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-sse`](../apps/starter-sse/)                             | Server-Sent Events feed of content changes (Hono `streamSSE`)                                                            | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working (polled — swaps to native pub/sub when ADR-001 lands) |
| [`apps/starter-websocket`](../apps/starter-websocket/)                 | Bidirectional WebSocket feed (`@hono/node-ws`)                                                                           | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working (polled — swaps to native pub/sub when ADR-001 lands) |
| [`apps/starter-hono-rpc`](../apps/starter-hono-rpc/)                   | Hono RPC (`hc` client) — third typed-API surface alongside tRPC + GraphQL                                                | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-minio-docker`](../apps/starter-minio-docker/)           | Self-hosted via docker-compose: Hono + MinIO + `laikacms/storage-s3` (one command)                                       | **S3 / MinIO**                    | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-fly-io`](../apps/starter-fly-io/)                       | Fly.io: Hono + volume-backed FS (Tigris/S3 path documented)                                                              | FileSystem (or Tigris)            | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-render`](../apps/starter-render/)                       | Render.com: blueprint (`render.yaml`) + persistent disk, GitHub auto-deploy                                              | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-mcp-server`](../apps/starter-mcp-server/)               | Model Context Protocol server — AI agents (Claude Desktop, Cursor, etc.) read/write content via stdio                    | FileSystem                        | n/a (agent-driven)                                        | ✅ Working                                                       |
| [`apps/starter-openapi`](../apps/starter-openapi/)                     | Typed REST + auto-gen OpenAPI 3.1 spec + Scalar interactive UI                                                           | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-meilisearch`](../apps/starter-meilisearch/)             | Full-text search via Meilisearch — indexer + `/search` endpoint                                                          | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-i18n`](../apps/starter-i18n/)                           | Multilingual content — `Accept-Language` negotiation + per-doc language field + fallback chain                           | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-rss`](../apps/starter-rss/)                             | RSS 2.0 + Atom + JSON Feed + `sitemap.xml` — zero-dep renderers                                                          | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-webhooks`](../apps/starter-webhooks/)                   | Outbound HMAC-signed webhooks on content change (Slack / deploy hooks / sync)                                            | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-multi-tenant`](../apps/starter-multi-tenant/)           | Per-tenant Laika instances with isolated content namespaces (SaaS pattern)                                               | FileSystem (or S3 `keyPrefix`)    | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-stripe-paywall`](../apps/starter-stripe-paywall/)       | Stripe Checkout + paywall — free preview for visitors, full body for subscribers                                         | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-email-digest`](../apps/starter-email-digest/)           | Email subscribers + scheduled per-subscriber digest of new posts via Resend; one-click unsubscribe                       | FileSystem                        | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |
| [`apps/starter-comments`](../apps/starter-comments/)                   | Built-in moderated comments backed by LaikaCMS records (two collections in one config); IP rate-limited; admin queue     | FileSystem                        | Decap via `decapAdminHtml()` (queue lives in the same UI) | ✅ Working                                                       |
| [`apps/starter-google-drive-blog`](../apps/starter-google-drive-blog/) | Hono — Google Drive real folder hierarchy, path→id cache, tokenProvider for token refresh, no googleapis SDK             | **Google Drive**                  | Decap via `decapAdminHtml()`                              | ✅ Working                                                       |

More are coming — Deno Deploy, native pub/sub.

### `laikacms/storage-s3` — first-party S3 adapter (new)

Shipped in this iteration: `import { createS3Bucket } from 'laikacms/storage-s3'`. Builds an
R2Bucket-shaped facade over `@aws-sdk/client-s3` (or any S3-shaped client). Feed the result to
`new R2StorageRepository(bucket, serializers, ext)` and everything that targets R2 —
`R2StorageRepository`, `createWorkersLaika`, etc. — works over the S3 API unchanged.

Closes the loop the Vercel Edge and Netlify Functions starters opened: every S3-compatible object
store (AWS S3, MinIO, Backblaze B2, Cloudflare R2 via S3 endpoint, DigitalOcean Spaces, Wasabi,
etc.) is now a one-line plug.

### `createCustomLaika()` — third preset (storage-agnostic)

New in this iteration: `@laikacms/decap-integrations/custom.createCustomLaika({ storage, ... })`
takes any pre-built `StorageRepository` and wires the rest (ContentBase document/asset repos, config
seeding, Decap JSON:API). Same return shape as the other two presets.

```ts
import { createCustomLaika, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
const storage = await createDrizzleStorage(DB_URL); // your own factory
const laika = createCustomLaika({
  storage,
  decapConfig: minimalBlogConfig(),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
```

Use this when your storage has nontrivial setup (async migrations, connection pools, multi-tenant
prefixes) that the FS/R2-specific presets don't accommodate. The Drizzle starter (above) was the 30+
lines of by-hand wiring that motivated this preset; it's now ~10 lines.

### Roadmap note from this iteration

The Vercel Edge starter highlights a gap: every "edge / object-store" target (Vercel Blob, Netlify
Blobs, Deno KV, Bun S3 binding, etc.) needs its own `StorageRepository` implementation to fully
work. Right now the only first-party object-store backend is R2. A future `createVercelLaika` /
`createNetlifyLaika` preset, or a generic S3-compatible `StorageRepository`, would close this
without per-host adapter hacks.

> **Note:** the cloud routine has merged its own variants of Astro, Next, SvelteKit, Nuxt, Remix,
> TanStack, Eleventy, Express, Hono, Workers, and Lambda. Those live alongside the local-built
> equivalents — the directory naming distinguishes them (`-blog` from the cloud routine, `-backend`
> or `-r2`/`-spa` for local-only variants). See the `apps/` directory for the full list.

### `decapAdminHtml()` — admin shell as a helper

`@laikacms/decap-integrations/embedded` now ships `decapAdminHtml(options?)` — returns the full
Decap CMS admin HTML as a string. Replaces the ~50-line static file every previous starter shipped.

```ts
import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';
app.get('/admin', c => c.html(decapAdminHtml({ decapConfig })));
```

Options: `decapConfig`, `title`, `baseUrl`, `decapBundleUrl`, `laikaBackendUrl`,
`embeddedBundleUrl`. Override the bundle URLs for SRI, pinned versions, or self-hosting.

The Lit starter is the first to use it. The older starters can migrate in a few lines each — a
follow-up cleanup pass.

## Presets

`@laikacms/decap-integrations` ships two one-call presets that compose the right repos + API + auth
for their respective runtimes:

| Subpath                                 | Runtime            | Storage    | Helpers                                                      |
| --------------------------------------- | ------------------ | ---------- | ------------------------------------------------------------ |
| `@laikacms/decap-integrations/embedded` | Node.js            | FileSystem | `createEmbeddedLaika`, `minimalBlogConfig`                   |
| `@laikacms/decap-integrations/workers`  | Cloudflare Workers | R2         | `createWorkersLaika`, `MinimalR2Bucket`, `DEFAULT_DEV_TOKEN` |

Both return the same shape: `{ fetch, authenticateRequest, storage, documents, assets }`. Mount
`fetch` from your framework's catch-all route; call the repos directly from server-side render paths
to bypass the (authenticated) HTTP API.

### Where the Decap admin lives, per framework

Every SSR framework hydrates React/Vue/Svelte into the whole `<html>` document. Decap CMS also
expects to own the full document. The starters use whichever escape hatch the framework provides:

| Framework         | Decap admin mount                                                              |
| ----------------- | ------------------------------------------------------------------------------ |
| Next.js           | `iframe srcDoc` inside an App Router page                                      |
| Astro             | `<script is:inline>` inside a `.astro` page (Astro doesn't hydrate by default) |
| SvelteKit         | `+server.ts` endpoint returning a raw HTML response                            |
| Nuxt              | Static file in `public/admin/index.html` (Nuxt serves `public/` verbatim)      |
| Hono              | Static file shipped with the source, served via `app.get('/admin', ...)`       |
| TanStack Start    | Static file in `public/admin.html`                                             |
| Eleventy (static) | Sidecar Hono server on a separate port (the public Eleventy site is static)    |

If your framework has a static-asset directory, prefer that — it's the cleanest decoupling.

## `minimalBlogConfig()` — boilerplate-free Decap config

Every starter needs a Decap config object. After hand-writing the same posts collection 4 times,
`@laikacms/decap-integrations/embedded` now ships a helper:

```ts
import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  decapConfig: minimalBlogConfig(), // one posts collection with title/date/body
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
```

Override any of the defaults if needed:

```ts
minimalBlogConfig({
  mediaFolder: 'static/uploads', // SvelteKit / Nuxt
  collectionName: 'articles',
  extension: 'json',
  extraCollections: [pagesCollection],
});
```

The Nuxt starter uses it as-is. The earlier starters still hand-roll their config — a follow-up will
migrate them. Frameworks that no one ends up maintaining will be moved to `apps/starters-archive/`
rather than deleted; surfacing doc gaps is the point, and even a broken starter is a useful corpus
when figuring out which docs and API ergonomics need improvement.

## What every starter must show

- **Embed**: how to host the LaikaCMS HTTP API inside the framework's own server (route handlers,
  endpoints, middleware).
- **Read on the server**: how to render content server-side **without** going through HTTP. The HTTP
  API requires auth on every endpoint other than `/health`, but `createEmbeddedLaika` returns the
  underlying `storage` / `documents` / `assets` repositories — call them directly with
  `laikacms/compat`'s `runTask` / `collectStream` helpers.
- **Admin**: how to mount a Decap CMS shell. The most LLM-friendly approach is a static HTML page
  that loads Decap from a CDN and registers the `laika` backend. The most production-ready approach
  is the Vite + `@laikacms/decap` fork build in `apps/decap-cms-laika-app`.

## How to add a starter

1. Run the workspace from the latest `develop` (`git pull --rebase`).
2. Create `apps/starter-<framework>-<flavor>/` with a private `package.json`
   (`@laikacms/starter-<...>`, `private: true`, `workspace:*` for `laikacms` and
   `@laikacms/decap-integrations`).
3. Use `createEmbeddedLaika({ contentDir, decapConfig, basePath, auth: { mode: 'dev' } })` for
   server wiring. Seed one sample post under `content/posts/`.
4. Render the post list on the home page using `laika.documents.listRecords({...})` and
   `collectStream(...)` from `laikacms/compat`.
5. Mount the Decap admin at `/admin`. The starter README must call out anything you had to do that
   the embedded preset didn't already handle.
6. Write a README that explains the layout, how to run, and the known **production hardening steps**
   (real auth, persistent storage, self-hosted Decap bundle).
7. If you had to dig into the laika packages to figure something out — fix the docs or add the
   missing helper while it's fresh.

## Why this directory exists

A starter doubles as a **continuous documentation audit**. If you can't bootstrap a new framework in
under an hour by following the existing docs, that's a documentation bug. Fix the docs (or the
ergonomics they describe) before moving on to the next framework. See ROADMAP.md for the rolling
list of frameworks to cover.
