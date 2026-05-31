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

#### Zero-adapter (WHATWG-native — pass directly)

These runtimes and frameworks pass a real WHATWG `Request` to your handler. No conversion needed.

| Framework / Runtime          | Handler signature                      | How to call laika                                         |
| ---------------------------- | -------------------------------------- | --------------------------------------------------------- |
| **Astro**                    | `({ request }) => Response`            | `laika.fetch(request)`                                    |
| **SvelteKit**                | `({ request }) => Response`            | `laika.fetch(event.request)`                              |
| **Remix / React Router v7**  | `(args: { request }) => Response`      | `laika.fetch(request)`                                    |
| **Next.js (App Router)**     | `(request: NextRequest) => Response`   | `laika.fetch(request)` (NextRequest extends Request)      |
| **TanStack Start**           | `({ request }) => Response`            | `laika.fetch(request)`                                    |
| **SolidStart**               | `(event: APIEvent) => Response`        | `laika.fetch(event.request)`                              |
| **Qwik City**                | `(ev: RequestEventLoader) => Response` | `ev.send(await laika.fetch(ev.request))`                  |
| **Analog (Angular / Nitro)** | h3 event via `toWebRequest`            | `laika.fetch(toWebRequest(event))`                        |
| **Cloudflare Workers**       | `(request: Request, env) => Response`  | `laika.fetch(request)`                                    |
| **Netlify Functions v2**     | `(req: Request) => Response`           | `laika.fetch(req)`                                        |
| **Deno.serve()**             | `(request: Request) => Response`       | `laika.fetch(request)`                                    |
| **Bun.serve()**              | `(request: Request) => Response`       | `laika.fetch(request)`                                    |
| **Hono** (any runtime)       | `(c: Context) => Response`             | `laika.fetch(c.req.raw)` (`c.req.raw` is the raw Request) |
| **Nuxt / H3 / Nitro**        | `(event: H3Event) => Response`         | `laika.fetch(toWebRequest(event))` from `h3`              |
| **Vike** (Hono backend)      | via Hono context                       | `laika.fetch(c.req.raw)`                                  |

#### Node.js `IncomingMessage` bridge

These frameworks pass `IncomingMessage` / `ServerResponse` (Node.js HTTP, predating the Web API).
You must construct a WHATWG `Request` manually. All use the same pattern; the difference is how the
body is drained.

| Framework        | Body draining method                                     | Notes                                                                              |
| ---------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Express**      | `for await (const chunk of req) chunks.push(chunk)`      | req is a Readable stream                                                           |
| **Fastify**      | `addContentTypeParser('*', { parseAs: 'buffer' }, fn)`   | Body is a pre-parsed `Buffer` passed to the handler                                |
| **Koa**          | `for await (const chunk of ctx.req) chunks.push(chunk)`  | `ctx.respond = false` required to bypass Koa's response middleware                 |
| **Hapi**         | route option `payload: { parse: false, output: 'data' }` | Body is a pre-drained `Buffer` in `request.payload`; `request.method` is lowercase |
| **NestJS**       | `NestFactory.create(App, { rawBody: true })`             | `req.rawBody` is a `Buffer`; without this option the stream is consumed            |
| **Polka**        | `for await (const chunk of req) chunks.push(chunk)`      | `req.params` is `IncomingMessage & { params: Record<string,string> }`              |
| **micro**        | `await buffer(req, { limit: '10mb' })`                   | `buffer()` from the `micro` package drains the stream to `Buffer`                  |
| **plain `http`** | `for await (const chunk of req) chunks.push(chunk)`      | Reference implementation — all other bridges are variants of this                  |

#### Cloud function event bridges

These platforms pass a platform-specific event object. The bridge converts it to a WHATWG `Request`.

| Platform                 | Input type               | Bridge approach                                                                                                       |
| ------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **AWS Lambda**           | `APIGatewayProxyEventV2` | Reconstruct `Request` from `event.rawPath`, `event.headers`, `event.body`                                             |
| **GCP Cloud Functions**  | `functions.Request`      | Extends Express `Request`; use standard IncomingMessage bridge                                                        |
| **Azure Functions v4**   | `HttpRequest`            | Has `.url`, `.method`, `.headers`, `.arrayBuffer()` but is NOT a WHATWG Request; construct `new Request(...)` from it |
| **Netlify Functions v1** | `HandlerEvent`           | `event.body` is a base64 string; decode + reconstruct `Request` manually                                              |

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

### Edge runtimes — `createEmbeddedLaika` is Node.js only

`createEmbeddedLaika` uses `node:fs` and `node:path` internally (via `FileSystemStorageRepository`).
It cannot run in **edge runtimes** such as Cloudflare Workers' edge deployment, Vercel Edge
Functions, Deno Deploy, or any V8-isolate-only environment.

This affects:

- Cloudflare Workers (use `wrangler dev` for local dev, but do not deploy with `createEmbeddedLaika`
  — use `createLaika` with a cloud storage backend instead)
- Vercel Edge Functions (`runtime: 'edge'`)
- Netlify Edge Functions

The Node.js runtime variants of each platform **do** work:

- Vercel Serverless Functions (Node.js runtime, not `runtime: 'edge'`)
- Netlify Functions v2 (Node.js runtime)
- AWS Lambda Node.js runtime

For edge-compatible deployments, replace `FileSystemStorageRepository` with a cloud-based storage
backend (GitHub API, S3, R2, etc.) and call `createLaika()` directly instead of
`createEmbeddedLaika()`.

### Hapi — `request.method` is lowercase

Hapi normalizes HTTP methods to **lowercase** (`'get'`, `'post'`, etc.) before calling your handler.
WHATWG `Request` is case-sensitive for methods — `GET` and `HEAD` may not carry a body. Always call
`.toUpperCase()` before passing to `new Request()`:

```ts
const method = request.method.toUpperCase(); // 'get' → 'GET'
```

### Hapi — `payload.parse: false` required for the Decap proxy

Hapi parses JSON and form bodies by default. Without explicit opt-out, `laika.fetch` receives a
pre-parsed object instead of the raw payload, corrupting non-JSON requests (multipart media
uploads).

```ts
server.route({
  method: '*',
  path: '/api/decap/{path*}',
  options: {
    payload: {
      parse: false, // don't parse — laika handles content-type
      output: 'data', // drain stream → Buffer before handler runs
      allow: '*/*',
    },
  },
  handler: async (request, h) => {
    const buf = request.payload as Buffer;
    const body = buf?.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return toHapiResponse(await laika.fetch(new Request(url, { method, headers, body })), h);
  },
});
```

### NestJS — `rawBody: true` required for the Decap proxy

NestJS uses body-parser which consumes the stream before controllers run. The raw bytes are only
available if you opt in:

```ts
const app = await NestFactory.create(AppModule, { rawBody: true });
```

Then in the controller, `req.rawBody` is a `Buffer` containing the undecoded body.

### Fastify — `addContentTypeParser('*', ...)` required for the Decap proxy

Fastify parses bodies for registered content types only. Register a catch-all parser to get a
`Buffer` for all payloads:

```ts
fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body);
});
```

The `body` argument to your route handler is then a `Buffer`.

### Koa — `ctx.respond = false` required

Koa's default middleware writes `ctx.body` to the response at the end of the middleware chain. If
you write directly to `ctx.res` (required to stream the laika response), set `ctx.respond = false`
first to prevent the double-write:

```ts
ctx.respond = false;
// now write to ctx.res directly
```

### Deno / Bun — `import.meta.dirname` vs `process.cwd()`

Both Deno (1.28+) and Bun expose `import.meta.dirname` — the absolute path of the directory
containing the current module file. It's more reliable than `process.cwd()` for resolving content
directories relative to the source:

```ts
// Deno / Bun (import.meta.dirname available)
contentDir: resolve(import.meta.dirname!, '..', 'content');

// Node.js (import.meta.dirname available from Node 21.2+)
// Falls back to:
contentDir: resolve(process.cwd(), 'content'); // CWD changes with shell context
```

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
