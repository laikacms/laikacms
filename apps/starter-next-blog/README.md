# starter-next-blog

Minimal blog built with [Next.js](https://nextjs.org) (App Router) and LaikaCMS. Demonstrates the
canonical embedded pattern:

- **`createEmbeddedLaika`** — one call wires up filesystem storage, Decap config syncing, documents
  repo, and the Decap JSON:API fetch handler.
- **`laika.documents.*` via `laikacms/compat`** — `runTask` / `collectStream` give you
  Promise-friendly access to content inside server components, without importing Effect.
- **Decap admin from CDN** — `decap-cms.js` injected at runtime; the laika backend plugin is
  dynamically imported from `@laikacms/decap-integrations`.

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
    decap-config.ts       # Shared collection schema (server + admin)
    laika.ts              # createEmbeddedLaika singleton
  app/
    layout.tsx            # Root layout with nav
    page.tsx              # Blog homepage (server component)
    blog/[slug]/page.tsx  # Individual post (server component)
    admin/
      layout.tsx          # Full-viewport layout for Decap CMS
      page.tsx            # Admin client component — loads Decap from CDN
    api/decap/[...path]/route.ts  # Proxies all methods to laika.fetch
content/                  # Filesystem content root (git-tracked)
```

## How content reading works

```ts
import { laika } from '@/lib/laika';
import { collectStream, runTask } from 'laikacms/compat';

// List all published posts (server component)
const { items } = await collectStream(
  laika.documents.listRecordSummaries({
    pagination: { page: 1, perPage: 100 },
    folder: 'posts',
    depth: 1,
    type: 'published',
  }),
);

// Fetch a single post by key
const post = await runTask(laika.documents.getDocument('posts/my-first-post'));
console.log(post.content.title); // frontmatter fields
```

## Auth modes

| Mode     | When to use                                    |
| -------- | ---------------------------------------------- |
| `dev`    | Local development — no credentials required    |
| `custom` | Production — provide `authenticateAccessToken` |

## Rendering markdown

The `body` field from Decap CMS is raw markdown. This starter renders it inside a `<pre>` so the
content is visible without additional dependencies. In production swap it for `next-mdx-remote` or
`remark`/`rehype`.

## Deployment

```bash
pnpm build
pnpm start
```

Runs on Node.js. For Vercel, set `output: 'standalone'` in `next.config.ts` and deploy normally.
