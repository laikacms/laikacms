# Framework setup notes

Gaps discovered while building the canonical starter apps (LCMS-023). Each note is a one-time
footgun — do it once and forget it.

### Framework adapter matrix

`laika.fetch` (and `api.fetch`) expects a **Web API `Request`**. The table below shows what each
framework gives you at the route handler boundary and whether you need a bridge.

| Framework                         | What you receive                                 | Bridge needed?                                                                                                                          |
| --------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Astro**                         | Web API `Request`                                | None — pass directly: `laika.fetch(request)`                                                                                            |
| **SvelteKit**                     | Web API `Request`                                | None — pass directly: `laika.fetch(event.request)`                                                                                      |
| **Remix**                         | Web API `Request`                                | None — pass directly: `laika.fetch(request)`                                                                                            |
| **Next.js (App Router)**          | `NextRequest` (extends Web API `Request`)        | None — pass directly: `laika.fetch(request)`                                                                                            |
| **Hono**                          | Hono `HonoRequest` wrapper                       | None — use `c.req.raw`: `laika.fetch(c.req.raw)`                                                                                        |
| **TanStack Start**                | Web API `Request`                                | None — pass directly from the server route handler                                                                                      |
| **Cloudflare Workers**            | Web API `Request`                                | None — Workers environment is spec-compliant                                                                                            |
| **Nuxt / h3**                     | h3 `H3Event`                                     | `toWebRequest(event)` from `h3`: `laika.fetch(toWebRequest(event))`                                                                     |
| **Express / plain `http.Server`** | Node.js `IncomingMessage`                        | Manual bridge — see [Express bridge](#express--plain-httpserver--manual-bridge) below                                                   |
| **AdonisJS v6**                   | AdonisJS `HttpContext` (wraps `IncomingMessage`) | `ctx.request.request` + `ctx.response.response` — same Express bridge in a controller                                                   |
| **NestJS (Express adapter)**      | Node.js `IncomingMessage` (via Express)          | Manual bridge in `NestMiddleware.use(req, res)` — same as Express                                                                       |
| **FoalTS v4**                     | FoalTS `Context` (Express-based)                 | Wrap FoalTS app inside bare Express; use `express.raw()` before mounting FoalTS — see [FoalTS](#foalts-v4--outer-express-wrapper) below |
| **Fastify**                       | Fastify `FastifyRequest`                         | `request.raw` → same Express bridge inside a Fastify route handler                                                                      |
| **AWS Lambda (via http bridge)**  | Lambda event object                              | Manual bridge — convert Lambda event → WHATWG `Request` before passing to `laika.fetch`                                                 |

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

### AdonisJS v6 — access the raw Node.js request via `ctx.request.request`

AdonisJS v6 is **ESM-native** — it can import `laikacms` and `@laikacms/decap` directly without the
dynamic `import()` workaround required by CommonJS frameworks like NestJS.

AdonisJS wraps `IncomingMessage` in its own `Request` class. The raw Node.js objects are:

```ts
// app/controllers/decap_controller.ts
import type { HttpContext } from '@adonisjs/core/http';
import { Readable } from 'node:stream';

export default class DecapController {
  async proxy({ request, response }: HttpContext) {
    const req = request.request; // raw IncomingMessage
    const res = response.response; // raw ServerResponse

    const url = new URL(req.url!, `http://${req.headers.host}`);

    // Collect body (same bridge as Express)
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);

    const webRequest = new Request(url.toString(), {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: body.byteLength > 0 && req.method !== 'GET' && req.method !== 'HEAD'
        ? (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer)
        : null,
      ...(body.byteLength > 0 ? { duplex: 'half' } : {}),
    } as RequestInit);

    const webResponse = await laika.fetch(webRequest);

    res.statusCode = webResponse.status;
    webResponse.headers.forEach((value, name) => res.setHeader(name, value));
    if (webResponse.body) {
      Readable.fromWeb(webResponse.body as import('stream/web').ReadableStream).pipe(res);
    } else {
      res.end();
    }

    // Prevent AdonisJS from sending a second response
    response.finish();
  }
}
```

Wire the catch-all route in `start/routes.ts`:

```ts
import router from '@adonisjs/core/services/router';
const DecapController = () => import('#controllers/decap_controller');
router.any('/api/decap/*', [DecapController, 'proxy']);
```

### FoalTS v4 — outer Express wrapper

FoalTS v4 is a **decorator-based TypeScript MVC** framework that uses Express internally. Its
`createApp` function registers the body parser as part of the app bootstrap — you cannot add
middleware to the resulting app that runs _before_ the body parser.

For the Decap proxy you need the raw binary body (for file uploads etc.). The solution is to wrap
the FoalTS app inside a **plain Express app**, register `express.raw()` there first, then mount
FoalTS beneath it:

```ts
// src/index.ts
import 'reflect-metadata';
import { createApp } from '@foal/core';
import express from 'express';
import * as http from 'node:http';
import { AppController } from './app/app.controller.js';
import { laika } from './app/laika.js';

const PORT = Number(process.env.PORT ?? 3000);

const outer = express();

// express.raw() runs BEFORE FoalTS body parser because FoalTS is mounted after.
outer.use(
  '/api/decap',
  express.raw({ type: '*/*', limit: '50mb' }),
  async (req, res) => {
    const url = `http://localhost:${PORT}${req.originalUrl}`;
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const body = hasBody && Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : null;

    const webRes = await laika.fetch(
      new Request(url, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body,
      }),
    );

    res.status(webRes.status);
    webRes.headers.forEach((value: string, name: string) => {
      if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
    });
    res.send(Buffer.from(await webRes.arrayBuffer()));
  },
);

const foalApp = await createApp(AppController);
outer.use(foalApp as express.RequestHandler); // FoalTS handles everything else

http.createServer(outer).listen(PORT);
```

FoalTS controllers return `HttpResponse` objects and use `@Get`/`@Post`/`@All` decorators. Because
they sit behind the Decap proxy in the Express chain, the CMS never reaches FoalTS routing and the
body parser issue is bypassed entirely.

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

### SvelteKit-specific patterns

#### Env access

SvelteKit enforces its own env model. Vite won't populate `process.env` from `.env` in dev. Use
`$env/dynamic/private` instead:

```ts
import { env } from '$env/dynamic/private';
const token = env.LAIKA_ADMIN_TOKEN;
```

#### Module-level singleton datasource init

SvelteKit server modules are singletons (persistent Node process). Initialize datasources at module
level, not per-request:

```ts
// src/lib/laika.ts
import { decapApi } from '@laikacms/decap/decap-api';
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { resolve } from 'node:path';

// Module-level singletons — initialized once, reused across all requests
const storage = new FileSystemStorageRepository(
  resolve(process.cwd(), 'content'),
  { md: markdownSerializer },
  'md',
);
const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });

export const laika = decapApi({
  documents: new ContentBaseDocumentsRepository(storage, settings),
  storage,
  assets: new ContentBaseAssetsRepository(storage, settings),
  basePath: '/api/decap',
  authenticateAccessToken: yourValidator,
});
```

#### Decap admin via `+page.svelte` + `onMount`

SvelteKit has no `c.html()` equivalent for serving a raw admin shell. The correct pattern uses a
`+page.svelte` that bootstraps Decap via `onMount`:

```svelte
<!-- src/routes/admin/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';

  onMount(() => {
    window.CMS_MANUAL_INIT = true;
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js';
    script.onload = async () => {
      const { default: createLaikaBackend } = await import(
        '@laikacms/decap-cms/backends/laika'
      );
      window.CMS.registerBackend('laika', createLaikaBackend());
      window.CMS.init({ config: { /* your decap config */ } });
    };
    document.head.appendChild(script);
  });
</script>
```
