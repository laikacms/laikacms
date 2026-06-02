# `@laikacms/starter-lit-spa`

A **framework-less** Web Components SPA, authored with [Lit](https://lit.dev) (5KB). LaikaCMS-backed
content is fetched via the sidecar Hono backend. Demonstrates two things:

1. **You don't need a framework.** Custom Elements + Shadow DOM are the platform; Lit is just a thin
   authoring layer on top.
2. **The new `decapAdminHtml()` helper.** This is the first starter to use it — the previous
   starters each shipped a ~50-line copy of the Decap admin HTML. Now it's one line.

## Stack

- Vite (dev/build) + Lit 3
- Custom Elements: `<post-list>` and `<post-detail>` in `src/`
- Sidecar Hono backend on `:3001` for `/api/*` and `/admin`
- Vite proxies `/api/*` and `/admin` to the backend for single-origin DX
- `@laikacms/decap-integrations/embedded` — `createEmbeddedLaika`, `minimalBlogConfig`,
  **`decapAdminHtml`**

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-lit-spa dev
```

Open `http://localhost:3000`. The admin is at `/admin` (proxied to the backend on `:3001`).

## Layout

```
apps/starter-lit-spa/
├── content/posts/hello-world.md
├── index.html                         # static shell with <post-list>
├── src/
│   ├── main.ts                        # custom-element registrations + hash-routing
│   ├── post-list.ts                   # <post-list> Lit element
│   └── post-detail.ts                 # <post-detail> Lit element
├── server/
│   └── server.ts                      # Hono backend + decapAdminHtml() admin shell
├── vite.config.ts
└── tsconfig.json
```

## What `decapAdminHtml()` saves

Previous starters had this in `server/admin/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>...50 lines of script tags, config object, CMS.init call...</head>
  <body>...</body>
</html>
```

Now the entire admin route is:

```ts
import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';

const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'My CMS' });
app.get('/admin', c => c.html(ADMIN_HTML));
```

Three lines. The helper templates the same HTML (Decap UMD from a CDN + laika backend registration +
`CMS.init`) but lets you override the bundle URLs for SRI / pinned versions / self-hosting in
production.

## Production hardening

Same as every other starter. See [`docs/starters.md`](../../docs/starters.md).
