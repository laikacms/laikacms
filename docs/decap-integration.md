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
