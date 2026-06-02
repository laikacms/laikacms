# starter-solidstart-blog

Minimal blog built with [SolidStart](https://start.solidjs.com) v1 and LaikaCMS. Demonstrates:

- **`createEmbeddedLaika`** — one call wires up filesystem storage, Decap config syncing, documents
  repo, and the Decap JSON:API fetch handler.
- **`query()` + `"use server"`** — SolidStart's server-function mechanism gives typed, cached SSR
  data loading. `laika.documents.*` runs on the server only; the client never sees Node.js APIs.
- **API routes** — `src/routes/api/decap/[...path].ts` exports named HTTP methods that forward to
  `laika.fetch`. SolidStart API routes receive a Web API `Request` directly — no adapter needed.
- **Decap admin from CDN** — `onMount` bootstraps Decap CMS on the client after the route renders.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin> for the CMS editor (dev
auth — no login required).

## Project layout

```
src/
  lib/
    decap-config.ts     # Shared collection schema
    laika.ts            # createEmbeddedLaika singleton ("use server" module)
    content.ts          # query() functions for SSR data loading
  routes/
    index.tsx           # Blog homepage — lists published posts
    blog/[slug].tsx     # Individual post — SSR via createAsync + getPost()
    admin.tsx           # Decap CMS admin (client-only bootstrap via onMount)
    api/decap/[...path].ts  # REST proxy to laika.fetch
  app.tsx               # SolidStart root with FileRoutes
app.config.ts           # SolidStart / vinxi config
content/                # Filesystem content root (git-tracked)
```

## How content reading works

```ts
// src/lib/content.ts
import { query } from '@solidjs/router';
import { collectStream, runTask } from 'laikacms/compat';
import { laika } from './laika.js';

export const getPosts = query(async () => {
  'use server'; // extracted to server-only RPC by vinxi
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({ ... }),
  );
  return items.filter(r => r.type === 'published-summary');
}, 'posts');
```

In routes, `createAsync(() => getPosts())` returns a SolidJS signal. The data is preloaded
server-side on navigation and hydrated on the client.

## Doc gaps surfaced

**`"use server"` placement**: the directive must be the very first statement in a function body. Any
import, comment-outside-the-body, or expression before it silently disables the directive and ships
the function to the client bundle.

**No wildcard method handler**: SolidStart API routes require explicit method exports (GET, POST,
PUT, DELETE, etc.) — unlike Astro (`const handler: APIRoute`), TanStack (`ANY`), or SvelteKit
(`fallback`). Documented in the API route file.

**`"use server"` at module level**: marking `laika.ts` with `"use server"` at the top excludes the
entire module from the client bundle. This is different from the function-level directive.

## Auth modes

| Mode     | When to use                                    |
| -------- | ---------------------------------------------- |
| `dev`    | Local development — no credentials required    |
| `custom` | Production — provide `authenticateAccessToken` |

## Deployment

```bash
pnpm build   # outputs to .output/
pnpm start   # serves the built app
```

The built server is a Node.js process. Point a reverse proxy at it and set `PORT` to override the
default.
