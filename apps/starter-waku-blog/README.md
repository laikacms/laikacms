# starter-waku-blog

Minimal blog built with [Waku](https://waku.gg) (the minimal React RSC framework) and LaikaCMS.
Demonstrates the canonical embedded pattern in a React Server Components context:

- **`createEmbeddedLaika`** — one call wires up filesystem storage, Decap config syncing, documents
  repo, and the Decap JSON:API fetch handler.
- **`laika.documents.*` via `laikacms/compat`** — `runTask` / `collectStream` called directly inside
  async React Server Components, no Effect import needed.
- **`laika.fetch` in Waku API routes** — Waku's `ApiHandler` receives a Web API `Request` and
  expects a `Response`. No `IncomingMessage→Request` bridge required (unlike Express or Eleventy).
- **Decap admin from CDN** — served via a raw-HTML API route at `/admin`; the laika backend plugin
  is bundled by esbuild.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin> for the CMS editor (dev
auth — no login required).

## Project layout

```
waku.config.ts            # Waku configuration (adapter, base path)
src/
  entries.tsx             # createPages: registers RSC pages + API routes
  laika.ts                # createEmbeddedLaika singleton
  decap-config.ts         # Shared collection schema (server + admin)
  admin-client.ts         # esbuild entry → public/admin/bundle.js
  pages/
    index.tsx             # Blog homepage (async RSC)
    blog/[slug].tsx       # Individual post (async RSC)
public/
  admin/
    bundle.js             # esbuild output (built by build:admin)
content/                  # Filesystem content root (git-tracked)
```

## How content reading works

```ts
// src/pages/index.tsx — async React Server Component
import { collectStream } from 'laikacms/compat';
import { laika } from '../laika.js';

export default async function HomePage() {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );
  // items is an array of record summaries
}
```

## API routes in Waku

Waku's `ApiHandler` type:

```ts
type ApiHandler = (
  req: Request,
  ctx: { params: Record<string, string | string[]> },
) => Promise<Response>;
```

This is the Web API `Request` / `Response` pair — same types `laika.fetch` expects. Pass through
directly:

```ts
createApi({
  render: 'dynamic',
  path: '/api/decap/[...path]',
  handlers: { all: req => laika.fetch(req) },
});
```

**Doc gap surfaced**: Waku (like Hono, Astro, SvelteKit, Next.js App Router) passes a native
`Request` to route handlers. The `IncomingMessage→Request` bridge documented for Express-family
frameworks is not needed here — add Waku to the "no bridge" row of the framework adapter matrix.

## Auth modes

| Mode     | When to use                                    |
| -------- | ---------------------------------------------- |
| `dev`    | Local development — no credentials required    |
| `custom` | Production — provide `authenticateAccessToken` |

## Deployment

```bash
pnpm build    # esbuild + waku build → dist/
pnpm start    # waku start (serves dist/)
```

Waku supports multiple deployment targets via adapters: `waku/adapters/node` (default),
`waku/adapters/cloudflare-workers`, `waku/adapters/aws-lambda`, etc. Change `unstable_adapter` in
`waku.config.ts` to target a different platform.

## Note on `react-server-dom-webpack`

Waku uses `react-server-dom-webpack` as the RSC transport layer — this is React's official RSC
implementation, not tied to webpack for production bundling. It must be installed alongside `react`
and `react-dom` even though the name is misleading.
