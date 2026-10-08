# Local Mode Dev Editing

Local mode lets the Decap admin read and write content against a real LaikaCMS JSON:API mounted
directly on the Vite dev server — no separate API process, no cloud account, no credentials. It is
the fastest path from `vite dev` to a live edit in the Decap UI.

The mode has two parts:

1. **`localApi` plugin option** — the Vite plugin mounts LaikaCMS's own JSON:API under `/__laika`
   while `vite dev` is running.
2. **`resolveLaikaBackend`** — the Decap backend helper selects the local API in dev and the real
   remote backend in production, with no manual switching.

---

## Prerequisites

You need the `@laikacms/vite-plugin` (Slice 1) and the `@laikacms/decap-cms` fork (for
`resolveLaikaBackend` and `createLaikaBackend`). The
[FileSystem + Decap quickstart](./quickstart-fs) covers both installs in full.

---

## 1. Enable local mode in the Vite plugin

Add `localApi: true` to the plugin in `vite.config.ts`:

```ts
// vite.config.ts
import { laikacms } from '@laikacms/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [laikacms({ dir: 'content', localApi: true })],
});
```

With `localApi: true`, the plugin mounts these routes on the Vite dev server:

| Route                | Purpose                                                  |
| -------------------- | -------------------------------------------------------- |
| `/__laika/storage`   | Storage repository JSON:API                              |
| `/__laika/documents` | Documents repository JSON:API                            |
| `/__laika/assets`    | Assets repository JSON:API (media uploads land locally)  |
| `/__laika/session`   | Stub identity responder for the Decap backend login flow |

These are unauthenticated by design and only ever reachable through the running dev server — nothing
in the `build` phase or `configurePreviewServer` mounts them, so a production build has no route to
them by construction.

> **Non-loopback warning:** if you start the dev server with `--host`, the plugin logs a warning
> that the unauthenticated API is reachable from the network. The API is still mounted — exposure is
> your explicit choice.

To change the base path, pass an options object instead:

```ts
laikacms({ dir: 'content', localApi: { basePath: '/__laika' } });
```

---

## 2. Wire `resolveLaikaBackend` in the admin entry

`resolveLaikaBackend` is exported from `@laikacms/decap-cms/backends/laika`. It selects the
**local** backend when the dev flag is truthy and the **remote** backend otherwise, failing safe to
remote whenever `import.meta.env.DEV` is not set.

```ts
// admin/index.ts
import { DecapCmsApp as CMS } from '@laikacms/decap-cms';
import { resolveLaikaBackend } from '@laikacms/decap-cms/backends/laika';

// resolveLaikaBackend({ local, remote }) — selects on import.meta.env.DEV.
// In `vite dev`: local backend → targets /__laika, no real auth (DevAuthenticationPage).
// In production build: remote backend → the full OAuth2 flow you pass in `remote`.
const LaikaBackend = resolveLaikaBackend({
  local: {}, // use defaults: base path /__laika, no auth required
  remote: {
    // Your production backend options for createLaikaBackend:
    base_url: 'https://your-laika-api.example.com',
    api_root: '/api',
  },
});

CMS.registerBackend('laika', LaikaBackend);
CMS.init();
```

The `remote` shape is the same options object you would pass to `createLaikaBackend` directly (see
[Authentication](./auth) for the full production OAuth2 setup).

### Vite-bundled admin is required

`resolveLaikaBackend` reads `import.meta.env.DEV`, which is only injected by the Vite bundler. The
admin entry file must be a TypeScript (or JavaScript) file compiled by esbuild/Vite — a static
`config.yml` backend declaration will never see `import.meta.env.DEV` and will fail safe to the
remote backend even in dev.

**This means local mode only engages when the admin is built from a TypeScript entry.**

> See [Serving the Admin Shell](./admin-shell) for the esbuild compile step that produces
> `admin/bundle.js` from `admin/index.ts`.

---

## 3. Run locally

```bash
# Start the Vite dev server (mounts /__laika endpoints)
npx vite dev
```

Open the admin at the URL Vite prints (e.g. `http://localhost:5173`). The Decap admin logs in
automatically without an OAuth prompt — `DevAuthenticationPage` handles the local session — and
every save goes to the local repository.

> **Same-origin:** when the admin is served through `vite dev` at the same origin as the API, no
> CORS configuration is needed. If you serve the admin separately (e.g. on a different port), add a
> `cors` option to your `laikaApi` call as shown in the quickstart.

---

## How it works

```
vite dev
├── laika: imports — inlined at build time from the filesystem repository
└── /__laika/*   — live JSON:API (storage + documents + assets + session)
       ↑
       admin/index.ts → resolveLaikaBackend → local backend (DevAuthenticationPage)
                                              reads import.meta.env.DEV = true
```

Production build skips the `localApi` mount entirely; `resolveLaikaBackend` receives
`import.meta.env.DEV = false` and selects the remote backend. No code change needed between dev and
production.

---

## See also

- [Vite plugin reference](../vite) — full `localApi` option docs and `mountLocalApi` for custom dev
  servers
- [FileSystem + Decap quickstart](./quickstart-fs) — end-to-end setup without local mode
- [Serving the Admin Shell](./admin-shell) — esbuild compile step
- [Authentication](./auth) — production OAuth2 setup for the `remote` backend
