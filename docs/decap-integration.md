# Decap CMS Integration

Two integration shapes are supported, in increasing order of complexity:

| Pattern                                                 | When to use                                            | Backend host                                                                           | Auth                             |
| ------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------- |
| **[Hosted gateway](#hosted-gateway-multi-tenant)**      | Multiple sites sharing one Decap admin + Laika backend | A separate Worker / server you operate (the `laika-gateway` app moved to its own repo) | GitHub OAuth (or other provider) |
| **[Standalone Worker](#standalone-worker-byo-storage)** | You want full control of storage, auth, and routing    | Your own Hono/Worker app                                                               | JWT (or your scheme)             |

The primary documented integration path is the **Standalone Worker (BYO storage)** wiring below: you
construct a `StorageRepository`, wrap it in the ContentBase document/asset repos, and expose them
through `decapApi(...)`. Everything else (admin shell, OAuth2, framework bridges) builds on top of
that handler.

---

## Standalone Worker (BYO storage)

This is the primary integration path. Wire the pieces by hand: pick a `StorageRepository`, wrap it
in the ContentBase document/asset repos, and expose them through `decapApi(...)`. The resulting
`api.fetch` is a Web-standard `(Request) => Promise<Response>` handler you mount on a catch-all
route.

```ts
import { decapApi } from '@laikacms/decap/decap-api';
import { Hono } from 'hono';
import { ContentBaseAssetsRepository } from 'laikacms/assets/contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents/contentbase';
import { R2StorageRepository } from 'laikacms/storage/r2';
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

Swap `R2StorageRepository` for any other `StorageRepository` implementation to change where content
lives:

| Subpath                    | Class                           | Where                           |
| -------------------------- | ------------------------------- | ------------------------------- |
| `laikacms/storage/fs`      | `FileSystemStorageRepository`   | Node.js local disk              |
| `laikacms/storage/r2`      | `R2StorageRepository`           | Cloudflare R2                   |
| `laikacms/storage/s3`      | S3 shim → `R2StorageRepository` | AWS S3 / MinIO / B2 / DO Spaces |
| `laikacms/storage/drizzle` | `DrizzleStorageRepository`      | Any SQL DB via Drizzle ORM      |
| `laikacms/storage/webdav`  | `WebDavStorageRepository`       | Any RFC 4918 WebDAV server      |

> `FileSystemStorageRepository` requires `node:fs` and a writable local filesystem, so it runs on
> **Node.js** and **Deno 2** (which supports `node:` built-ins) but not on edge runtimes (Cloudflare
> Workers, Deno Deploy, Vercel Edge, …). On the edge, use an edge-compatible storage repo such as
> `R2StorageRepository`.

`api.fetch` is the catch-all handler. To call content directly from server-side render code (and
bypass the authenticated HTTP API), use the `documents` / `assets` / `storage` repos you
constructed.

### Seeding the server-side Decap config

`DecapContentBaseSettingsProvider` reads your Decap config object from storage on **every** content
request — it uses the `collections` array to resolve collection → folder mappings, field schemas,
and media paths. Before any document or asset operation will succeed, seed that config into storage
once (e.g. in a setup script, a one-time migration, or a first-boot handler):

```ts
import { runTask } from 'laikacms/compat';

await runTask(
  storage.createOrUpdateObject({
    key: 'config', // must match the `configKey` option you passed to DecapContentBaseSettingsProvider
    content: {
      collections: [
        {
          name: 'posts', // Decap collection name — also used as the storage folder path
          label: 'Posts',
          folder: 'posts', // folder inside your storage where documents live
          create: true,
          fields: [
            { name: 'title', widget: 'string' },
            { name: 'body', widget: 'markdown' },
          ],
        },
        // …more folder collections…
      ],
      media_folder: 'uploads', // storage folder where uploaded assets are written
      public_folder: '/uploads', // URL prefix embedded in content when Decap references an asset
    },
  }),
);
```

**Serializer requirement.** The config object is structured data. Your storage instance must
register a serializer that round-trips arbitrary objects — `yamlSerializer`, `jsonSerializer`, or
`markdownSerializer` all work. Do **not** use `rawSerializer`: it stores only a plain `body` string
and discards all other fields, so seeding with it silently writes an empty config and every content
request still fails.

**Server config vs. browser config.** There are two separate copies of your Decap config:

| Copy                 | Where                                 | Used by                                                                                        |
| -------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Storage (server)** | Object stored under `configKey`       | `DecapContentBaseSettingsProvider` on every request — maps collection names to storage folders |
| **Browser**          | Passed to `CMS.init({ config: {…} })` | Decap CMS React app — controls which collections appear and how fields render                  |

Both copies must describe the same collections. The recommended pattern is to keep a single
`decapConfig` constant and share it:

```ts
// shared/decap-config.ts — one source of truth for both sides
export const decapConfig = {
  backend: { name: 'laika', api_root: '/api/decap' },
  media_folder: 'uploads',
  public_folder: '/uploads',
  collections: [
    {
      name: 'posts',
      label: 'Posts',
      folder: 'posts',
      create: true,
      fields: [{ name: 'title', widget: 'string' }, { name: 'body', widget: 'markdown' }],
    },
  ],
};
```

Seed it server-side once:

```ts
import { runTask } from 'laikacms/compat';
import { decapConfig } from './shared/decap-config.js';

await runTask(storage.createOrUpdateObject({ key: 'config', content: decapConfig }));
```

Pass it to the browser:

```ts
window.CMS.init({ config: decapConfig });
```

> **Skipping this step** is the most common reason a Standalone Worker deployment returns
> `404 "The file at config does not exist"` on every content request. The storage is simply empty —
> seed the config object once and all content operations immediately work.

### WebDAV storage

`WebDavStorageRepository` works with Nextcloud, ownCloud, Apache `mod_dav`, nginx-dav, rclone, and
any other RFC 4918 server. Only a URL (and optionally Basic auth) is needed. Construct it like any
other `StorageRepository` and pass it to `decapApi(...)`:

```ts
import { decapApi } from '@laikacms/decap/decap-api';
import { ContentBaseAssetsRepository } from 'laikacms/assets/contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents/contentbase';
import { jsonSerializer } from 'laikacms/serializers/json';
import { markdownSerializer } from 'laikacms/serializers/markdown';
import { rawSerializer } from 'laikacms/serializers/raw';
import { yamlSerializer } from 'laikacms/serializers/yaml';
import { WebDavStorageRepository } from 'laikacms/storage/webdav';

const storage = new WebDavStorageRepository(
  {
    baseUrl: process.env.WEBDAV_URL, // https://cloud.example.com/remote.php/dav/files/alice
    auth: { username: 'alice', password: '…' }, // omit for anonymous / token auth
  },
  { md: markdownSerializer, yml: yamlSerializer, json: jsonSerializer, raw: rawSerializer },
  'md', // default extension for new documents
);

const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
const api = decapApi({
  documents: new ContentBaseDocumentsRepository(storage, settings),
  storage,
  assets: new ContentBaseAssetsRepository(storage, settings),
  basePath: '/api/decap',
  authenticateAccessToken: yourValidator,
});

export const laika = api;
```

The `starter-webdav-blog` example (a complete WebDAV setup including an embedded local-dev WebDAV
server) was moved out of this monorepo in June 2026 — see
[restructure-2026-06.md](./restructure-2026-06.md).

---

## Serving the Decap admin shell

The admin UI loads Decap from a CDN, registers the Laika backend, and points at your `decapApi`
route. Build a small HTML page that does this and serve it from a non-page route (so your
framework's SSR hydration doesn't fight Decap for the `<html>` element):

```ts
const ADMIN_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>My Admin</title>
    <!--
      Import map: resolves the bare @laikacms/decap specifier for the browser.
      esm.sh re-bundles the package on the fly and handles all transitive imports.
      Pin to a specific version (e.g. @1.0.1) in production.
    -->
    <script type="importmap">
    {
      "imports": {
        "@laikacms/decap/decap-cms-backend-laika": "https://esm.sh/@laikacms/decap/decap-cms-backend-laika"
      }
    }
    </script>
  </head>
  <body>
    <script src="https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js"></script>
    <script>
      window.CMS_MANUAL_INIT = true;
    </script>
    <script type="module">
      import createLaikaBackend from '@laikacms/decap/decap-cms-backend-laika';
      window.CMS.registerBackend('laika', createLaikaBackend());
      window.CMS.init({
        config: {
          backend: { name: 'laika', api_root: '/api/decap' },
          // …collections…
        },
      });
    </script>
  </body>
</html>`;

// Hono
app.get('/admin', c => c.html(ADMIN_HTML));
// Express
app.get('/admin', (_req, res) => res.send(ADMIN_HTML));
```

For full control (custom widgets, the Decap React tree) you can instead render a React island:

```ts
// src/components/DecapAdmin.tsx (a React island)
import DecapCmsCore, { App, DecapCmsProvider } from '@laikacms/decap-cms/core';
import DEFAULT_WIDGET_STRING from '@laikacms/decap-cms/widget-string';
import { createLaikaBackend } from '@laikacms/decap/decap-cms-backend-laika';
// …other widgets…

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
    },
  };
  return (
    <DecapCmsProvider config={cfg}>
      <App />
    </DecapCmsProvider>
  );
}
```

The `authenticateAccessToken` validator you pass to `decapApi(...)` decides who may call the API.
For local development you can accept a pre-shared token; for production, validate a real session/JWT
(or front the whole thing with the `decap-oauth2` server below).

### Machine-to-machine auth with `authenticateApiToken`

For server-to-server or CI/CD integrations that cannot perform an OAuth2 browser flow, you can
enable API key authentication by passing the optional `authenticateApiToken` option. When present,
any request that supplies a key via **either** of the two accepted header formats is routed through
this callback instead of `authenticateAccessToken`:

| Header format                 | Example                                |
| ----------------------------- | -------------------------------------- |
| `X-API-Key: <key>`            | `X-API-Key: sk-live-abc123`            |
| `Authorization: ApiKey <key>` | `Authorization: ApiKey sk-live-abc123` |

> Note: supplying `api_key` as a URL query-string parameter is explicitly rejected — keys in URLs
> leak through server logs, CDN logs, and browser history.

```ts
import { decapApi } from '@laikacms/decap/decap-api';

const api = decapApi({
  documents,
  storage,
  authenticateAccessToken: async token => {
    // validate OAuth2 / JWT bearer token
    const session = await db.sessions.findByAccessToken(token);
    if (!session) throw new Error('Invalid session');
    return db.users.findById(session.userId);
  },
  // Optional: enable API key auth for machine-to-machine access
  authenticateApiToken: async key => {
    const apiKey = await db.apiKeys.findByKey(key);
    if (!apiKey) throw new Error('Invalid API key');
    return db.users.findById(apiKey.userId);
  },
});
```

If `authenticateApiToken` is not configured and a request arrives with `X-API-Key` or
`Authorization: ApiKey`, the server returns `401`.

### Logging with `logger`

Pass any `logger` compatible with the `Console` interface (`error`, `warn`, `info`, `debug`) to
receive structured diagnostic output from `decapApi`. The option is optional — if omitted, no output
is produced.

```ts
const api = decapApi({
  documents,
  storage,
  authenticateAccessToken: yourValidator,
  logger: console, // or a structured logger such as pino / winston
});
```

The logger is forwarded to the underlying `storage-api` and `documents-api` handlers so you get a
unified log stream from a single option.

### Production auth with `decap-oauth2`

Rather than building an OAuth2 server from scratch, use the bundled `decapOauth2` helper. It is a
self-contained PKCE authorization server with email/password login, optional passkey (WebAuthn), and
optional TOTP 2FA. You wire it alongside the `decapApi(...)` handler in the same Express or Hono
app.

```bash
pnpm add @laikacms/decap
```

**Hono example**

```ts
import { decapApi } from '@laikacms/decap/decap-api';
import { decapOauth2 } from '@laikacms/decap/decap-oauth2';
import { Hono } from 'hono';
import { ContentBaseAssetsRepository } from 'laikacms/assets/contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents/contentbase';
import { R2StorageRepository } from 'laikacms/storage/r2';

const CLIENT_ID = process.env.DECAP_CLIENT_ID!;
const OAUTH_BASE = '/oauth2';

const oauth2 = decapOauth2({
  basePath: OAUTH_BASE,
  clientId: CLIENT_ID,
  callbacks: {
    // Return User | null — { id, email, passwordHash }
    getUserByEmail: async email => db.users.findByEmail(email),
    getUserById: async id => db.users.findById(id),

    // Authorization codes (one-time use, short-lived)
    storeAuthorizationCode: async code => db.authCodes.insert(code),
    getAuthorizationCode: async code => db.authCodes.findByCode(code),
    deleteAuthorizationCode: async code => db.authCodes.deleteByCode(code),

    // Sessions (hold both access + refresh tokens)
    createSession: async session => db.sessions.insert(session),
    getSessionByAccessToken: async token => db.sessions.findByAccessToken(token),
    getSessionByRefreshToken: async token => db.sessions.findByRefreshToken(token),
    logoutSession: async sessionId => db.sessions.deleteById(sessionId),
    logoutAll: async userId => db.sessions.deleteAllForUser(userId),
  },
});

// Build the Decap API handler — its validator checks the OAuth2 session token.
const storage = new R2StorageRepository(/* … */);
const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
const laika = decapApi({
  documents: new ContentBaseDocumentsRepository(storage, settings),
  storage,
  assets: new ContentBaseAssetsRepository(storage, settings),
  basePath: '/api/decap',
  // Reject by throwing — decapApi turns thrown errors into a 401.
  async authenticateAccessToken(token) {
    const session = await db.sessions.findByAccessToken(token);
    if (!session) throw new Error('Invalid session');
    const user = await db.users.findById(session.userId);
    if (!user) throw new Error('Unknown user');
    return { id: user.id, email: user.email, name: user.email };
  },
});

const app = new Hono();
app.all(`${OAUTH_BASE}/*`, c => oauth2.fetch(c.req.raw));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

export default app;
```

**Express example** (uses the [manual bridge](#express--plain-httpserver--manual-bridge) for
`laika`):

```ts
import { decapOauth2 } from '@laikacms/decap/decap-oauth2';
import express from 'express';

const oauth2 = decapOauth2({ basePath: '/oauth2', clientId: CLIENT_ID, callbacks });

const app = express();
// oauth2 speaks Web API — it has its own body parsing, no express.json() needed here
app.all('/oauth2/*', async (req, res) => {
  const url = `${req.protocol}://${req.headers.host}${req.originalUrl}`;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : null;
  const webRequest = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: body
      ? (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer)
      : null,
    ...(body ? { duplex: 'half' } : {}),
  } as RequestInit);
  const webResponse = await oauth2.fetch(webRequest);
  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => res.setHeader(key, value));
  res.send(Buffer.from(await webResponse.arrayBuffer()));
});
// Mount laika with the same bridge (see Express bridge section)
app.all('/api/decap/*', (req, res) => bridgeToLaika(req, res, laika));
```

**Point Decap at the OAuth2 server**

In your Decap config, set `backend.base_url` to the origin where the OAuth2 server runs and
`backend.auth_endpoint` to the authorize path:

```ts
const decapConfig = {
  backend: {
    name: 'laika',
    api_root: '/api/decap',
    base_url: 'https://cms.example.com', // origin serving /oauth2/*
    auth_endpoint: '/oauth2/authorize',
  },
  // …collections…
};
```

Use this same `decapConfig` when building the admin shell (see
[Serving the Decap admin shell](#serving-the-decap-admin-shell) above) so the editor performs the
PKCE login against `/oauth2/authorize`.

**Optional extensions**

| Feature        | Option key in `decapOauth2(…)`       | Notes                                            |
| -------------- | ------------------------------------ | ------------------------------------------------ |
| Passkey        | `passkey: { enabled: true, … }`      | WebAuthn registration + authentication flows     |
| TOTP 2FA       | `totp: { … }`                        | TOTP enrollment and per-login verification       |
| CAPTCHA        | `captcha: { enabled: true, … }`      | Any provider (reCAPTCHA, hCaptcha, Turnstile, …) |
| Password reset | `passwordReset: { … }`               | Email-based reset link flow                      |
| i18n           | `translations: nl` (or other locale) | Import from `@laikacms/decap/decap-oauth2/i18n`  |

See
[`packages/decap/src/decap-oauth2/README.md`](https://github.com/laikacms/laikacms/blob/develop/packages/decap/src/decap-oauth2/README.md)
for the full `OAuthConfig` option reference.

---

## Hosted gateway (multi-tenant)

If multiple sites share one editing experience, host a gateway Worker separately and point each
site's Decap admin at it. Auth is per-tenant via GitHub OAuth (or other). Storage is the tenant's
own GitHub repo. The `laika-gateway` app and the `@laikacms/git-gateway` package were moved out of
this monorepo in June 2026 (see [restructure-2026-06.md](./restructure-2026-06.md)); they now live
in their own repositories.

---

## Widgets

| Widget       | Subpath                                        |
| ------------ | ---------------------------------------------- |
| AI Chat      | `@laikacms/decap-ai/widget`                    |
| Lucide Icons | `@laikacms/decap/decap-cms-widget-lucide-icon` |
| Radix Icons  | `@laikacms/decap/decap-cms-widget-radix-icon`  |

```ts
import DecapCmsCore from '@laikacms/decap-cms/core';
import { LucideIconPreview, LucideIconWidget } from '@laikacms/decap/decap-cms-widget-lucide-icon';

DecapCmsCore.registerWidget('lucide-icon', LucideIconWidget, LucideIconPreview);
```

---

## Package name collision (FYI)

There are **two** packages in the laika-cms ecosystem with confusingly similar names:

- **`@laikacms/decap`** — fork of upstream Decap CMS itself (the React `App`, `DecapCmsProvider`,
  widgets, backends like `backend-github`, etc.). Lives in
  [`laikacms/decap-cms#v4.beta`](https://github.com/laikacms/decap-cms).
- **`@laikacms/decap`** — adapters _around_ Decap: the `laika` Decap backend (`createLaikaBackend`),
  the Decap-compatible HTTP API (`decapApi`), the `decapOauth2` server, custom widgets. Lives in
  this repo under `packages/decap/`.

Their subpath exports do not overlap, so you can `pnpm add` both side by side.

---

## Framework setup notes

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
import { ContentBaseAssetsRepository } from 'laikacms/assets/contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents/contentbase';
import { markdownSerializer } from 'laikacms/serializers/markdown';
import { FileSystemStorageRepository } from 'laikacms/storage/fs';
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
        '@laikacms/decap/decap-cms-backend-laika'
      );
      window.CMS.registerBackend('laika', createLaikaBackend());
      window.CMS.init({ config: { /* your decap config */ } });
    };
    document.head.appendChild(script);
  });
</script>
```
