# Serving the Decap admin shell

The admin UI requires a compiled browser bundle — compile the Laika backend and Decap CMS together
with esbuild, then serve the resulting files as static assets.

> **Why not esm.sh / import maps?** esm.sh re-bundles packages on the fly but does not fully resolve
> deep `export *` barrel chains. The `@laikacms/decap-cms/backends/laika` subpath depends on symbols
> re-exported through several barrel layers (e.g. `DocumentsCompatibilityDate`) that esm.sh's
> bundler drops, so the admin silently fails to load. esbuild resolves all transitive imports at
> build time and produces a self-contained bundle with no runtime CDN dependency.

### Install build dependencies

```bash
npm install @laikacms/server @laikacms/decap-cms @emotion/react @emotion/styled esbuild --save-dev
```

`@laikacms/decap-cms` is the scoped Decap CMS fork that provides the `@laikacms/decap-cms/lib/util`,
`/lib/auth`, `/ui-default`, and `/core` subpaths required by the Laika backend at bundle time.
Without it the esbuild step will fail with "Could not resolve" errors. `@emotion/react` and
`@emotion/styled` are required (non-optional) peer dependencies of `@laikacms/decap-cms` — the admin
shell is styled with Emotion.

### Root import vs `laika-app/bare`

`@laikacms/decap-cms` ships two entry points for the admin app:

| Entry point                          | Bundle includes                                       | When to use                                                               |
| ------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `@laikacms/decap-cms` (root)         | All built-in widgets, backend, locales pre-registered | Quick setup; you just call `CMS.init()`                                   |
| `@laikacms/decap-cms/laika-app/bare` | Nothing pre-registered                                | Only register what you use — smaller bundle; used by all curated starters |

The bare entry requires explicit `CMS.registerBackend(...)` and `CMS.registerWidget(...)` calls:

```typescript
// admin/index.ts (bare approach — used by all starters)
import createLaikaBackend from '@laikacms/decap-cms/backends/laika';
import { CMS, init } from '@laikacms/decap-cms/laika-app/bare';
import en from '@laikacms/decap-cms/locales/en';
import DecapCmsWidgetString from '@laikacms/decap-cms/widgets/string';

CMS.registerLocale('en', en);
CMS.registerBackend('laika', createLaikaBackend());
CMS.registerWidget(DecapCmsWidgetString.Widget());
// register only the widgets your collections actually use

init({ config: {/* ... */} });
```

The root-import approach shown below is simpler but includes all widgets regardless of use:

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
> [quickstart-fs-decap](./quickstart-fs) for a complete `config.yml` example.

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
> same origin to avoid the need for CORS. See [quickstart-fs-decap](./quickstart-fs) for a complete
> working example.

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
