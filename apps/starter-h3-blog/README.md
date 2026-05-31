# starter-h3-blog

Minimal blog built with [H3](https://h3.unjs.io) and LaikaCMS. H3 is the HTTP toolkit that powers
Nitro (and by extension Nuxt). Using it directly — without Nitro's build tooling — shows the
WHATWG-native primitives that sit beneath the higher-level abstractions.

- **`createEmbeddedLaika`** — one call wires up filesystem storage, Decap config syncing, documents
  repo, and the Decap JSON:API fetch handler.
- **`laika.documents.*` via `laikacms/compat`** — `runTask` / `collectStream` give you
  Promise-friendly access to content inside H3 event handlers.
- **`toWebRequest` / `sendWebResponse`** — H3's WHATWG bridge converts between H3's event model and
  the WHATWG `Request`/`Response` objects that `laika.fetch` expects.
- **Decap admin from CDN** — static `public/admin/index.html` + esbuild-bundled laika backend.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin/> for the CMS editor (dev
auth — no login required).

## Project layout

```
src/
  admin-client.ts     # Browser bundle: registers laika backend + calls CMS.init()
  decap-config.ts     # Shared collection schema (server + admin)
  index.ts            # H3 app + Node.js HTTP server
  laika.ts            # createEmbeddedLaika singleton
public/
  admin/
    index.html        # Admin page — loads Decap from CDN + bundle.js
    bundle.js         # Built by esbuild from admin-client.ts (git-ignored)
  uploads/            # Uploaded media
content/              # Filesystem content root (git-tracked)
```

## How the Decap proxy works

H3 provides `toWebRequest` and `sendWebResponse` to bridge between H3's event model and WHATWG
`Request`/`Response`. The Decap proxy becomes:

```ts
router.use(
  '/api/decap/**',
  defineEventHandler(async event => {
    const request = toWebRequest(event); // H3 event → WHATWG Request
    const response = await laika.fetch(request); // delegate to LaikaCMS
    return sendWebResponse(event, response); // WHATWG Response → H3 event
  }),
);
```

This is the same WHATWG bridge Nitro uses internally. Using H3 directly shows the primitive without
the Nitro build/preset layer.

## Auth modes

| Mode     | When to use                                    |
| -------- | ---------------------------------------------- |
| `dev`    | Local development — no credentials required    |
| `custom` | Production — provide `authenticateAccessToken` |

## Deployment

```bash
pnpm build:admin   # bundles src/admin-client.ts → public/admin/bundle.js
pnpm start         # runs the H3 server on PORT (default 3000)
```

For edge deployment (Cloudflare Workers, Deno Deploy, etc.), replace `FileSystemStorageRepository`
in `createEmbeddedLaika` with the platform's storage adapter and use H3's edge-compatible entry
points (Nitro handles this automatically if you add it later).
