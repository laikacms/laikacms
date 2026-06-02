# starter-astro-blog

Minimal blog built with [Astro](https://astro.build) and LaikaCMS. Demonstrates the canonical
embedded pattern:

- **`createEmbeddedLaika`** — one call wires up filesystem storage, Decap config syncing, documents
  repo, and the Decap JSON:API fetch handler.
- **`laika.documents.*` via `laikacms/compat`** — `runTask` / `collectStream` give you
  Promise-friendly access to content without importing Effect.
- **Decap admin from CDN** — `decap-cms.js` loaded from unpkg; the laika backend plugin is bundled
  by Vite from `@laikacms/decap-integrations`.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:4321> for the blog and <http://localhost:4321/admin/> for the CMS editor (dev
auth — no login required).

## Project layout

```
src/
  decap-config.ts        # Shared collection schema (server + admin)
  laika.ts               # createEmbeddedLaika singleton
  pages/
    index.astro          # Blog homepage — lists published posts
    blog/[slug].astro    # Individual post
    admin/index.astro    # Decap CMS admin UI (Decap from CDN)
    api/decap/[...path].ts  # Proxies all methods to laika.fetch
content/                 # Filesystem content root (git-tracked)
```

## How content reading works

```ts
import { collectStream, runTask } from 'laikacms/compat';
import { laika } from './laika.js';

// List all published posts
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

```ts
// Production example
createEmbeddedLaika({
  auth: {
    mode: 'custom',
    authenticateAccessToken: async token => {
      const user = await myDb.verifyToken(token);
      if (!user) throw new AuthenticationError('Bad token');
      return { id: user.id, email: user.email, name: user.name };
    },
  },
});
```

## Rendering markdown

The `body` field from Decap CMS is raw markdown. This starter renders it inside a `<pre>` so the
content is visible without additional dependencies. In production you'd pipe it through
remark/rehype or use Astro's built-in `<Content>` component with a `.md` source.

## Deployment

Build for Node.js standalone:

```bash
pnpm build
node dist/server/entry.mjs
```

Point a reverse proxy (nginx, Caddy, etc.) at the Node server. Set `PORT` to override the default
`4321`.
