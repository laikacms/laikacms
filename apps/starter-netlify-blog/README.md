# starter-netlify-blog

A minimal blog built with [Netlify Functions v2](https://docs.netlify.com/functions/overview/) and
[LaikaCMS](https://github.com/laikacms/laikacms).

## What this demonstrates

- **Zero-adapter pattern**: Netlify Functions v2 passes a WHATWG-native `Request` directly to
  `laika.fetch(request)` — no bridging needed.
- **`createEmbeddedLaika`**: Wires up the full Decap JSON:API + auth handler in one call.
- **Decap CMS admin from CDN**: Static `public/admin/index.html` + esbuild-compiled
  `admin-client.ts` — no framework needed.
- **`laikacms/compat`**: `collectStream` / `runTask` for Promise-friendly content reads in server
  functions.

## Structure

```
netlify/
  functions/
    blog.ts      ← renders / and /blog/:slug
    decap.ts     ← proxies /api/decap/* to laika.fetch()
src/lib/
  decap-config.ts  ← Decap collection schema (shared server + client)
  laika.ts         ← singleton createEmbeddedLaika instance
public/
  admin/
    index.html   ← Decap CMS admin UI (CDN scripts + bundle.js)
    bundle.js    ← built by `pnpm build:admin` (gitignored)
  uploads/       ← media uploads (gitignored except .gitkeep)
content/         ← markdown files managed by Decap
admin-client.ts  ← esbuild entry: registers laika backend, calls CMS.init()
netlify.toml     ← build + dev config
```

## Getting started

```bash
pnpm install
pnpm dev        # builds admin bundle, then starts netlify dev
```

Open `http://localhost:8888` for the blog and `http://localhost:8888/admin/` for the CMS.

## How it works

### Zero-adapter (Netlify Functions v2)

Netlify Functions v2 handler signature:

```typescript
export default async function handler(req: Request): Promise<Response>;
```

The `req` is a real WHATWG `Request` — `laika.fetch(req)` works without any conversion:

```typescript
// netlify/functions/decap.ts
export default async function handler(req: Request) {
  return laika.fetch(req);
}
export const config: Config = { path: '/api/decap/*' };
```

Compare this to Express/Koa/Fastify where you must manually construct a `Request` from
`IncomingMessage`.

### Content reads

```typescript
import { collectStream, runTask } from 'laikacms/compat';
import { laika } from '../../src/lib/laika.js';

// List posts
const { items } = await collectStream(
  laika.documents.listRecordSummaries({ folder: 'posts', ... })
);

// Single post
const post = await runTask(laika.documents.getDocument('posts/my-slug'));
```

### Admin UI

`public/admin/index.html` loads Decap from CDN and `bundle.js` (built by esbuild from
`admin-client.ts`). The bundle registers the laika backend and calls `CMS.init()` with the same
collection config used by the server.
