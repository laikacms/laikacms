# Serving the Decap admin shell

The admin UI is a browser bundle. Two ways to get one:

- **[Load it from a CDN](#loading-from-a-cdn)** — zero build step; the prebuilt bundle registers the
  `laika` backend and boots on load. Start here.
- **[Build it yourself with esbuild](#building-your-own-bundle)** — tree-shaken to exactly the
  backends/widgets/locales you register. What the starters do (via the `bare` entries).

## Loading from a CDN

Both full app shells ship as prebuilt, self-contained browser bundles under `dist/cdn/`, so unpkg
and jsDelivr serve them straight off npm. Nothing else is needed: React, the backends, the widgets,
and the styles are inlined, and the bundle registers everything and calls `init()` on load.

```html
<!-- the Laika shell — the `laika` backend is pre-registered -->
<script src="https://cdn.jsdelivr.net/npm/@laikacms/decap-cms@4/dist/cdn/laika-cms.js"></script>

<!-- or the classic Decap shell -->
<script src="https://cdn.jsdelivr.net/npm/@laikacms/decap-cms@4/dist/cdn/decap-cms.js"></script>
```

The Laika bundle exposes a `LaikaCms` global; the classic bundle exposes `DecapCms` (and the usual
`window.CMS`). Set `window.CMS_MANUAL_INIT = true` before the script tag to register your own
widgets or preview templates first, then call `window.initCMS()`. ES module builds sit next to each
(`laika-cms.esm.js`, `decap-cms.esm.js`) for `<script type="module">`.

Pin an exact version (`@4.2.0`) rather than a range for production. The trade-off is size: a script
tag can't tree-shake, so the bundle is ~1.8 MB gzipped with every backend, widget, locale, and the
whole richtext editor included. If that matters, build your own bundle below.

## Building your own bundle

Compile the Laika backend and Decap CMS together with esbuild, then serve the resulting files as
static assets.

> **Why esbuild and not esm.sh / import maps?** esm.sh re-bundles packages on the fly but does not
> fully resolve deep `export *` barrel chains, so the admin silently fails to load. esbuild resolves
> all transitive imports at build time and produces a self-contained bundle with no runtime CDN
> dependency.

### Install build dependencies

```bash
npm install @laikacms/server @laikacms/decap-cms @emotion/react @emotion/styled esbuild --save-dev
```

`@laikacms/decap-cms` is the scoped Decap CMS fork that provides the `@laikacms/decap-cms/lib/util`,
`/lib/auth`, `/ui-default`, and `/core` subpaths required by the Laika backend at bundle time.
Without it the esbuild step will fail with "Could not resolve" errors. `@emotion/react` and
`@emotion/styled` are required (non-optional) peer dependencies of `@laikacms/decap-cms` — the admin
shell is styled with Emotion.

### Create the admin entry point

```typescript
// admin/index.ts
import { DecapCmsApp as CMS } from '@laikacms/decap-cms';
import { createLaikaBackend } from '@laikacms/decap-cms/backends/laika';

const LaikaBackend = createLaikaBackend();
CMS.registerBackend('laika', LaikaBackend);
CMS.init({
  config: {
    backend: {
      name: 'laika',
      base_url: 'http://localhost:3000', // URL where your LaikaCMS API is running; required
      api_root: '/api/decap',
      dev_token: 'dev-secret-change-me', // dev-only: bypasses OAuth2; remove for production
    },
    media_folder: 'uploads',
    public_folder: '/uploads',
    collections: [
      // same collections array as your server-side decapConfig
    ],
  },
});
```

> **`base_url` is required.** Without it, Decap cannot locate the Laika API and the admin shows
> "Missing required configuration: base_url and app_id are required". Set it to the origin where
> your `laikaApi` handler runs (e.g. `http://localhost:3000` locally, your public URL in
> production).
>
> **`dev_token`** lets the Decap admin authenticate without a full OAuth2 flow during development —
> any non-empty string works as long as your `authenticateAccessToken` callback accepts it. Remove
> this field before deploying to production and wire a real OAuth2 / JWT validator instead (see
> [Production auth with `decap-oauth2`](./auth#production-auth-with-decap-oauth2) below).
>
> Alternatively, omit `config:` from `CMS.init()` and place the backend settings in
> `admin/config.yml` next to `index.html` — Decap loads it automatically at startup. See
> [Quickstart: Node.js](../getting-started/nodejs) for a complete `config.yml` example.

### Create the HTML shell

```html
<!-- admin/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Admin</title>
  </head>
  <body>
    <!-- esbuild compiles admin/index.ts → admin/bundle.js -->
    <script src="bundle.js"></script>
  </body>
</html>
```

### Build and serve

```bash
# Build the bundle (re-run after editing admin/index.ts)
npx esbuild admin/index.ts --bundle --outfile=admin/bundle.js --format=iife --target=es2020

# Terminal 1 — LaikaCMS API (with CORS if admin runs on a different port)
npm start

# Terminal 2 — admin UI
npx serve admin/ -l 5000
```

Open `http://localhost:5000` to access the Decap CMS admin.

> **CORS:** when the admin (`npx serve -l 5000`) and the API (`:3000`) are on different origins, add
> `cors: { origins: ['http://localhost:5000'] }` to your `laikaApi(...)` call. Without it the
> browser blocks every request with a CORS error. In production, serve the admin and API from the
> same origin to avoid the need for CORS. See [Quickstart: Node.js](../getting-started/nodejs) for a
> complete working example.

For a framework server (Hono, Express, Astro, etc.), serve the `admin/` directory as static files
and mount it before any catch-all API handler:

```ts
// Hono + @hono/node-server
import { serveStatic } from '@hono/node-server/serve-static';
app.use('/admin/*', serveStatic({ root: './admin' }));

// Express
import express from 'express';
app.use('/admin', express.static('admin'));

// Then mount the API catch-all after
app.all('/api/decap/*', c => api.fetch(c.req.raw));
```

For full control (custom widgets, the Decap React tree) you can instead render a React island:

```ts
// src/components/DecapAdmin.tsx (a React island)
import { App } from '@laikacms/decap-cms/app';
import { createLaikaBackend } from '@laikacms/decap-cms/backends/laika';
import DecapCmsCore, { DecapCmsProvider } from '@laikacms/decap-cms/core';
import DEFAULT_WIDGET_STRING from '@laikacms/decap-cms/widgets/string';
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

The `authenticateAccessToken` validator you pass to `laikaApi(...)` decides who may call the API.
For local development you can accept a pre-shared token; for production, validate a real session/JWT
(or front the whole thing with the `decap-oauth2` server below).
