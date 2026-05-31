# Decap CMS Integration

Three integration shapes are supported, in increasing order of complexity:

| Pattern                                                               | When to use                                                                 | Backend host                                                      | Auth                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| **[Embedded](#embedded-same-origin-recommended-for-single-site-cms)** | The CMS edits content for a single site, and you control that site's server | Same process as the public site (Astro, Next, Hono, …)            | Dev token (local) or your own session check |
| **[Hosted gateway](#hosted-gateway-multi-tenant)**                    | Multiple sites sharing one Decap admin + Laika backend                      | A separate Worker / server you operate (see `apps/laika-gateway`) | GitHub OAuth (or other provider)            |
| **[Standalone Worker](#standalone-worker-byo-storage)**               | You want full control of storage, auth, and routing                         | Your own Hono/Worker app                                          | JWT (or your scheme)                        |

---

## Embedded (same-origin) — recommended for single-site CMS

This is the simplest integration. The Astro/Next/Hono site that serves the public pages also serves
`/admin` and `/api/decap/*`. No separate process, no OAuth dance for local dev, no CORS.

### Server

```bash
pnpm add @laikacms/decap-integrations laikacms
```

```ts
// src/lib/laika.ts (Astro example)
import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { decapConfig } from './decap-config.ts'; // your Decap CMS config object

export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' }, // pre-shared token, no OAuth
});
```

```ts
// src/pages/api/decap/[...path].ts
import type { APIRoute } from 'astro';
import { laika } from '~/lib/laika.ts';

export const prerender = false;
const handler: APIRoute = ({ request }) => laika.fetch(request);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
```

That's the entire server. `createEmbeddedLaika` constructs the filesystem-backed storage, the
ContentBase document + asset repos, and the `decapApi(...)` router. The first run seeds
`content/config.yml` from your `decapConfig` so the editor and the server agree on the schema.

> **Node.js only.** `createEmbeddedLaika` hardcodes `FileSystemStorageRepository`, which requires
> `node:fs`. It is incompatible with edge runtimes (Cloudflare Workers, Deno Deploy, etc.). For edge
> deployments, wire the pieces manually using `decapApi` — see
> [Standalone Worker](#standalone-worker-byo-storage) below.

### Client — Decap admin shell

Two ways to serve the admin UI:

**Option A — `decapAdminHtml()` (simpler, no build step)**

When you already have a running server, the simplest admin shell is a single function call. No
esbuild step, no `public/admin/bundle.js`, no React dependency. Available from all three presets
(`/embedded`, `/custom`, `/workers`):

```ts
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';

const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'My Admin' });

// Hono
app.get('/admin', c => c.html(ADMIN_HTML));
// Express
app.get('/admin', (_req, res) => res.send(ADMIN_HTML));
```

The function inlines the Decap config into a `<script>` that loads Decap from CDN and registers the
Laika backend. Dev-mode auth is wired automatically when `auth: { mode: 'dev' }` is passed to
`createCustomLaika` / `createEmbeddedLaika`.

**Option B — React island (full control, smaller bundle)**

Use when you need custom widgets or the Decap React tree:

```ts
// src/components/DecapAdmin.tsx (a React island)
import { createLaikaBackend } from '@laikacms/decap-integrations/decap-cms-backend-laika';
import DecapCmsCore, { App, DecapCmsProvider } from '@laikacms/decap/core';
import DEFAULT_WIDGET_STRING from '@laikacms/decap/widget-string';
// …other widgets…

import { DEFAULT_DEV_TOKEN } from '@laikacms/decap-integrations/embedded';
import { decapConfig } from '~/lib/decap-config.ts';

DecapCmsCore.registerBackend('laika', createLaikaBackend());
DecapCmsCore.registerWidget(DEFAULT_WIDGET_STRING);
// …etc…

export default function DecapAdmin() {
  const cfg = {
    ...decapConfig,
    backend: {
      ...decapConfig.backend,
      base_url: window.location.origin,
      dev_token: DEFAULT_DEV_TOKEN, // skip OAuth in dev
    },
  };
  return (
    <DecapCmsProvider config={cfg}>
      <App />
    </DecapCmsProvider>
  );
}
```

**Dev auth mode.** Setting `backend.dev_token` on the Decap config swaps the PKCE auth page for an
auto-login that immediately submits `dev_token`. The embedded server validates it against the same
token (passed to `createEmbeddedLaika({ auth: { mode: 'dev', devToken } })` — defaults to
`DEFAULT_DEV_TOKEN`). For production, drop the `dev_token` field and configure a real OAuth provider
in front (see the gateway pattern below) or pass a `mode: 'custom'` validator to
`createEmbeddedLaika`.

### Custom auth (production embedded)

```ts
import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';
import { jwtVerify } from 'jose'; // example

createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  decapConfig,
  basePath: '/api/decap',
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

## Hosted gateway (multi-tenant)

If multiple sites share one editing experience, host `apps/laika-gateway` separately and point each
site's Decap admin at it. Auth is per-tenant via GitHub OAuth (or other). Storage is the tenant's
own GitHub repo. See `apps/laika-gateway/src/index.ts` for the canonical shape.

---

## Standalone Worker (BYO storage)

For full control, wire the pieces by hand:

```ts
import { decapApi } from '@laikacms/decap-integrations/decap-api';
import { Hono } from 'hono';
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { R2StorageRepository } from 'laikacms/storage-r2';
// …serializers…

const app = new Hono<{ Bindings: Env }>();

app.all('/api/decap/*', async c => {
  const storage = new R2StorageRepository(/* … */);
  const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
  const api = decapApi({
    documents: new ContentBaseDocumentsRepository(storage, settings),
    storage,
    assets: new ContentBaseAssetsRepository(storage, settings),
    basePath: '/api/decap',
    authenticateAccessToken: yourValidator,
  });
  return api.fetch(c.req.raw);
});
```

---

## `createCustomLaika` — BYO storage preset

Between `createEmbeddedLaika` (filesystem, simple) and the raw `decapApi` wiring above sits
`createCustomLaika`. It takes a **pre-built `StorageRepository`** of any kind and wires the rest
automatically (content/asset repos, config seeding, Decap API, dev auth).

```ts
import { createCustomLaika } from '@laikacms/decap-integrations/custom';
// also re-exported from /embedded and /workers

const laika = createCustomLaika({
  storage, // any StorageRepository
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
app.all('/api/decap/*', c => laika.fetch(c.req.raw));
```

Available `StorageRepository` implementations:

| Subpath                    | Class                           | Where                           |
| -------------------------- | ------------------------------- | ------------------------------- |
| `laikacms/storage-fs`      | `FileSystemStorageRepository`   | Node.js local disk              |
| `laikacms/storage-r2`      | `R2StorageRepository`           | Cloudflare R2                   |
| `laikacms/storage-s3`      | S3 shim → `R2StorageRepository` | AWS S3 / MinIO / B2 / DO Spaces |
| `laikacms/storage-drizzle` | `DrizzleStorageRepository`      | Any SQL DB via Drizzle ORM      |
| `laikacms/storage-webdav`  | `WebDavStorageRepository`       | Any RFC 4918 WebDAV server      |

### WebDAV storage

`WebDavStorageRepository` works with Nextcloud, ownCloud, Apache `mod_dav`, nginx-dav, rclone, and
any other RFC 4918 server. Only a URL (and optionally Basic auth) is needed:

```ts
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';
import { WebDavStorageRepository } from 'laikacms/storage-webdav';

const storage = new WebDavStorageRepository(
  {
    baseUrl: process.env.WEBDAV_URL, // https://cloud.example.com/remote.php/dav/files/alice
    auth: { username: 'alice', password: '…' }, // omit for anonymous / token auth
  },
  { md: markdownSerializer, yml: yamlSerializer, json: jsonSerializer, raw: rawSerializer },
  'md', // default extension for new documents
);

export const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
```

See `apps/starter-webdav-blog` for a complete example including an embedded local-dev WebDAV server.

---

## Widgets

| Widget       | Subpath                                                     |
| ------------ | ----------------------------------------------------------- |
| AI Chat      | `@laikacms/decap-integrations/decap-cms-widget-ai-chat`     |
| Lucide Icons | `@laikacms/decap-integrations/decap-cms-widget-lucide-icon` |
| Radix Icons  | `@laikacms/decap-integrations/decap-cms-widget-radix-icon`  |

```ts
import {
  LucideIconPreview,
  LucideIconWidget,
} from '@laikacms/decap-integrations/decap-cms-widget-lucide-icon';
import DecapCmsCore from '@laikacms/decap/core';

DecapCmsCore.registerWidget('lucide-icon', LucideIconWidget, LucideIconPreview);
```

---

## Package name collision (FYI)

There are **two** packages in the laika-cms ecosystem with confusingly similar names:

- **`@laikacms/decap`** — fork of upstream Decap CMS itself (the React `App`, `DecapCmsProvider`,
  widgets, backends like `backend-github`, etc.). Lives in
  [`laikacms/decap-cms#v4.beta`](https://github.com/laikacms/decap-cms).
- **`@laikacms/decap-integrations`** — adapters _around_ Decap: the `laika` Decap backend, the
  JSON:API server (`decap-api`), the `createEmbeddedLaika` preset, custom widgets, OAuth proxies.
  Lives in this repo under `packages/decap/`.

Their subpath exports do not overlap, so you can `pnpm add` both side by side.

---

## Framework setup notes

Gaps discovered while building the canonical starter apps (LCMS-023). Each note is a one-time
footgun — do it once and forget it.

### Framework adapter matrix

`laika.fetch` (and `api.fetch`) expects a **Web API `Request`**. The table below shows what each
framework gives you at the route handler boundary and whether you need a bridge.

| Framework                         | What you receive                          | Bridge needed?                                                                                                                              |
| --------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Astro**                         | Web API `Request`                         | None — pass directly: `laika.fetch(request)`                                                                                                |
| **SvelteKit**                     | Web API `Request`                         | None — pass directly: `laika.fetch(event.request)`                                                                                          |
| **Remix / React Router v7**       | Web API `Request`                         | None — pass directly: `laika.fetch(request)`                                                                                                |
| **Next.js (App Router)**          | `NextRequest` (extends Web API `Request`) | None — pass directly: `laika.fetch(request)`                                                                                                |
| **Hono / HonoX**                  | Hono `HonoRequest` wrapper                | None — use `c.req.raw`: `laika.fetch(c.req.raw)`                                                                                            |
| **TanStack Start**                | Web API `Request`                         | None — pass directly from the server route handler                                                                                          |
| **Waku**                          | Web API `Request`                         | None — `ApiHandler` receives a standard `Request`: `handlers: { all: req => laika.fetch(req) }`                                             |
| **Bun.serve**                     | Web API `Request`                         | None — `Bun.serve({ fetch })` handler is spec-compliant                                                                                     |
| **Cloudflare Workers**            | Web API `Request`                         | None — Workers environment is spec-compliant                                                                                                |
| **Nuxt / h3**                     | h3 `H3Event`                              | `toWebRequest(event)` from `h3`: `laika.fetch(toWebRequest(event))`                                                                         |
| **Express / plain `http.Server`** | Node.js `IncomingMessage`                 | Manual bridge — see [Express bridge](#express--plain-httpserver--manual-bridge) below                                                       |
| **Fastify**                       | Node.js `IncomingMessage` (via `req.raw`) | Manual bridge — use `addContentTypeParser('*', { parseAs: 'buffer' })` to capture body bytes                                                |
| **VitePress (dev server)**        | Node.js `IncomingMessage`                 | Manual bridge via `configureServer` Vite plugin — see [VitePress dev server](#vitepress-docusaurus--vite-based-dev-servers) below           |
| **Docusaurus (dev server)**       | Node.js `IncomingMessage`                 | Manual bridge via `configureWebpack` + `setupMiddlewares` — see [VitePress dev server](#vitepress-docusaurus--vite-based-dev-servers) below |
| **Eleventy (11ty) dev server**    | Node.js `IncomingMessage`                 | Manual bridge via `setServerOptions({ middleware: [...] })`                                                                                 |
| **AWS Lambda (via http bridge)**  | Lambda event object                       | Manual bridge — convert Lambda event → WHATWG `Request` before passing to `laika.fetch`                                                     |

### Express / plain `http.Server` — manual bridge

Express and the raw Node.js `http` module use `IncomingMessage` / `ServerResponse`, which predate
the Web API. You must construct a WHATWG `Request` manually and pipe the response back:

```ts
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';

async function bridgeToLaika(
  req: ExpressRequest,
  res: ExpressResponse,
  laika: { fetch(r: Request): Promise<Response> },
) {
  const url = `${req.protocol}://${req.headers.host}${req.originalUrl}`;

  // Collect the body (Node streams are not Web ReadableStreams)
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const bodyBuffer = chunks.length ? Buffer.concat(chunks) : null;

  const webRequest = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    // TS6: pass .buffer (concrete ArrayBuffer), not the Buffer/Uint8Array directly
    body: bodyBuffer
      ? bodyBuffer.buffer.slice(
        bodyBuffer.byteOffset,
        bodyBuffer.byteOffset + bodyBuffer.byteLength,
      ) as ArrayBuffer
      : null,
    // Required when forwarding a body
    duplex: 'half',
  } as RequestInit);

  const webResponse = await laika.fetch(webRequest);

  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => res.setHeader(key, value));

  if (webResponse.body) {
    Readable.fromWeb(webResponse.body as import('stream/web').ReadableStream).pipe(res);
  } else {
    res.end();
  }
}
```

Wire it into Express:

```ts
app.all('/api/decap/*', (req, res) => bridgeToLaika(req, res, laika));
```

### TypeScript 6 — `BodyInit` regression with `Buffer` / `Uint8Array`

TypeScript 6 tightened the `BodyInit` type. `Buffer` and `Uint8Array<ArrayBufferLike>` are **no
longer assignable** to `BodyInit` because `ArrayBufferLike` is wider than `ArrayBuffer`. The
`Request` body constructor requires a **concrete `ArrayBuffer`**.

```ts
// TS6: Wrong — Buffer / Uint8Array<ArrayBufferLike> is not assignable to BodyInit
const req = new Request(url, { body: buffer }); // TS error in TS6
const req2 = new Request(url, { body: uint8Array }); // TS error in TS6 (ArrayBufferLike)

// TS6: Correct — extract the concrete ArrayBuffer slice
const req = new Request(url, {
  body: buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer,
});
```

This affects the Express bridge above and any place you build a `Request` from a Node.js `Buffer`.
The `.buffer` property of a `Buffer` is the **underlying shared** `ArrayBuffer`; always slice with
`byteOffset`/`byteLength` to avoid passing a larger backing buffer to the `Request`.

### VitePress / Docusaurus — Vite-based dev servers

VitePress and Docusaurus both run Node.js-based dev servers (Vite's Connect middleware and
webpack-dev-server respectively). You must register `laika.fetch` as a middleware rather than a
route handler, which means you get `IncomingMessage`/`ServerResponse` — not a Web API `Request`.

**VitePress** — use a Vite plugin with `configureServer`:

```ts
// .vitepress/config.mts
import { defineConfig } from 'vitepress';
import { laika } from '../src/laika.js';

export default defineConfig({
  vite: {
    plugins: [{
      name: 'laika-decap-api',
      configureServer(server) {
        server.middlewares.use('/api/decap', async (req, res) => {
          const webReq = await toWebRequest(req); // IncomingMessage → Request bridge
          const webRes = await laika.fetch(webReq);
          res.writeHead(webRes.status, Object.fromEntries(webRes.headers));
          res.end(Buffer.from(await webRes.arrayBuffer()));
        });
      },
    }],
  },
});
```

This approach means your VitePress `contentDir` and the LaikaCMS `contentDir` can be the same folder
— Decap CMS writes markdown files that VitePress renders directly.

**Docusaurus v3** — use `configureWebpack` (not `configureDevServer`):

> **Important:** Docusaurus v3's `Plugin` interface does **not** have a `configureDevServer`
> lifecycle hook, despite older documentation suggesting it does. The correct approach is to return
> a partial webpack config from `configureWebpack` using webpack-dev-server v5's `setupMiddlewares`:

```ts
// src/laika-plugin.ts
import type { Plugin } from '@docusaurus/types';

export default function laikaPlugin(): Plugin {
  return {
    name: 'laika-decap-api',
    configureWebpack(_config, isServer) {
      if (isServer) return;
      return {
        devServer: {
          // webpack-dev-server v5: setupMiddlewares replaces the old before/after hooks
          setupMiddlewares(middlewares: any[], devServer: any) {
            devServer.app.use('/api/decap', async (req: any, res: any) => {
              const webReq = await toWebRequest(req);
              const webRes = await laika.fetch(webReq);
              res.writeHead(webRes.status, Object.fromEntries(webRes.headers));
              res.end(Buffer.from(await webRes.arrayBuffer()));
            });
            return middlewares;
          },
        },
      } as any; // webpack-dev-server types are transitive, not direct deps
    },
  };
}
```

Register the plugin in `docusaurus.config.ts`:

```ts
import laikaPlugin from './src/laika-plugin.js';
const config: Config = {
  plugins: [laikaPlugin],
  // ...
};
```

### HonoX — typed layout props with `ContextRenderer`

HonoX uses `jsxRenderer` for layouts. The `c.render(content, extraProps)` overload that passes extra
props to the layout is only accepted by TypeScript when you augment the `ContextRenderer` interface:

```ts
// app/_renderer.tsx
import { jsxRenderer } from 'hono/jsx-renderer';

// Tell TypeScript that c.render() accepts { title?: string }
declare module 'hono' {
  interface ContextRenderer {
    (content: string | Promise<string>, props?: { title?: string }): Response;
  }
}

export default jsxRenderer(({ children, title }: { children?: unknown, title?: string }) => (
  <html>
    <head>
      <title>{title ?? 'My Blog'}</title>
    </head>
    <body>{children}</body>
  </html>
));
```

Without this augmentation, `c.render(<JSX />, { title: 'My Blog' })` produces a TypeScript error
(`Expected 1 arguments, but got 2`).

### Astro — use `laikacms/compat`, not `laikacms/core`

`runTask` and `collectStream` must be imported from `laikacms/compat`. The `laikacms/core` subpath
does not export them (this was a README bug fixed in PR #41).

```ts
// correct
import { collectStream, runTask } from 'laikacms/compat';

// wrong — named exports do not exist here
import { collectStream, runTask } from 'laikacms/core';
```

### Next.js (App Router) — admin page must be a client component

The `/admin` page must be a `'use client'` component that injects the Decap CDN script via
`useEffect`. There is no server-rendered equivalent: `next/script` with
`strategy="beforeInteractive"` does not work for third-party CDN scripts in Server Components.

```tsx
// app/admin/page.tsx
'use client';

import { useEffect } from 'react';

export default function AdminPage() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/decap-cms@^3/dist/decap-cms.js';
    script.async = true;
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  return <div id="nc-root" />;
}
```

### GitHub App storage — creating credentials

`GithubStorageRepository` authenticates as a **GitHub App**, not a personal access token. This gives
you scoped, revocable per-repo access that works for production deployments.

**One-time setup:**

1. Go to [github.com/settings/apps/new](https://github.com/settings/apps/new).
2. Set a name and homepage URL (any URL is fine for local dev).
3. Permissions: **Repository permissions → Contents → Read & Write**, **Metadata → Read**.
4. Uncheck "Active" under Webhook — you don't need webhooks.
5. Create the app and note the **App ID** on the settings page.
6. Under "Private keys", generate a key — download the `.pem` file.
7. Click **Install App**, select your content repo, and note the installation ID from the URL
   (`https://github.com/settings/installations/<INSTALLATION_ID>`).

```ts
import { GithubStorageRepository } from '@laikacms/github/storage-gh';

const doc = await runTask(laika.documents.getDocument('posts/hello-world'));
const { title, date, body } = doc.content as PostContent;
```

This is the pattern used in all canonical starters. It is safe as long as your collection definition
and interface stay in sync — they are not linked at the type level.

**Option 2 — Zod validation (runtime safety)**

Parse `doc.content` through a Zod schema for runtime guarantees:

```typescript
import { z } from 'zod';

const PostSchema = z.object({
  title: z.string(),
  date: z.string().optional(),
  description: z.string().optional(),
  body: z.string().optional(),
});
```

**Private key in env vars**: `.pem` files contain real newlines. Most hosting platforms store env
vars as single-line strings with literal `\n`. The `.replace(/\\n/g, '\n')` call in the snippet
above handles this. If you paste the key directly (e.g. in a `.env` file with quotes), the `replace`
is a harmless no-op.

If you need a JSON Schema representation of your content type (e.g. for OpenAPI, tRPC output
validation, or Feathers schemas), TypeBox gives you both a TypeScript type and a schema object from
a single definition:

```typescript
import { Static, Type } from '@sinclair/typebox';

const PostSchema = Type.Object({
  title: Type.String(),
  date: Type.Optional(Type.String()),
  body: Type.Optional(Type.String()),
});

type Post = Static<typeof PostSchema>;
```

**Known gap — no `zodSchemaFromCollection()` helper**

The Decap collection definition (`blogCollections` in your `decap-config.ts`) already describes
every field name, widget type, and whether the field is required. Ideally you could derive a Zod or
TypeBox schema directly from that definition instead of duplicating field names. This helper does
not exist yet — it is tracked as a future enhancement. Until then, keep your TypeScript interface /
Zod schema in sync with the collection definition manually.

### SvelteKit — `src/app.html` is required

SvelteKit does not generate an HTML shell automatically. Unlike Astro or Next.js, you must create
`src/app.html` explicitly or the dev server will error on startup.

```html
<!-- src/app.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```
