# starter-sveltekit-blog

Minimal blog built with [SvelteKit](https://kit.svelte.dev) and LaikaCMS. Demonstrates the canonical
embedded pattern:

- **`createEmbeddedLaika`** — one call wires up filesystem storage, Decap config syncing, documents
  repo, and the Decap JSON:API fetch handler.
- **`laika.documents.*` via `laikacms/compat`** — `runTask` / `collectStream` give you
  Promise-friendly access to content inside server load functions, without importing Effect.
- **Decap admin from CDN** — `decap-cms.js` injected at runtime via `onMount`; the laika backend
  plugin is dynamically imported from `@laikacms/decap-integrations`.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:5173> for the blog and <http://localhost:5173/admin> for the CMS editor (dev
auth — no login required).

## Project layout

```
src/
  lib/
    decap-config.ts       # Shared collection schema (server + admin)
    laika.ts              # createEmbeddedLaika singleton
    index.ts              # Re-exports from $lib
  routes/
    +layout.svelte        # Root layout with nav
    +page.server.ts       # Blog homepage load function
    +page.svelte          # Blog homepage component
    blog/[slug]/
      +page.server.ts     # Post load function
      +page.svelte        # Post component
    admin/
      +page.svelte        # Admin UI — loads Decap from CDN on mount
    api/decap/[...path]/
      +server.ts          # Proxies all methods to laika.fetch
content/                  # Filesystem content root (git-tracked)
```

## How content reading works

```ts
import { laika } from '$lib/laika';
import { collectStream, runTask } from 'laikacms/compat';

// In a +page.server.ts load function
const { items } = await collectStream(
  laika.documents.listRecordSummaries({
    pagination: { page: 1, perPage: 100 },
    folder: 'posts',
    depth: 1,
    type: 'published',
  }),
);

const post = await runTask(laika.documents.getDocument('posts/my-first-post'));
console.log(post.content.title);
```

## Auth modes

| Mode     | When to use                                    |
| -------- | ---------------------------------------------- |
| `dev`    | Local development — no credentials required    |
| `custom` | Production — provide `authenticateAccessToken` |

## Deployment

```bash
pnpm build
node build/index.js
```

Runs on Node.js via `@sveltejs/adapter-node`. For Cloudflare Workers swap to
`@sveltejs/adapter-cloudflare` and replace `FileSystemStorageRepository` with `R2StorageRepository`
from `laikacms/storage-r2`.
