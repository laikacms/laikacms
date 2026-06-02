# starter-nuxt-blog

Minimal blog built with [Nuxt 3](https://nuxt.com) and LaikaCMS. Demonstrates the canonical embedded
pattern adapted for Nuxt's Nitro server engine:

- **`createEmbeddedLaika`** in `server/utils/laika.ts` — one call wires up filesystem storage, Decap
  config syncing, documents repo, and the Decap JSON:API fetch handler.
- **`laika.documents.*` via `laikacms/compat`** — server API routes (`server/api/`) read content
  with `runTask` / `collectStream`; pages use `useFetch` to call those routes.
- **Decap admin from CDN** — `decap-cms.js` loaded dynamically in `onMounted`; the laika backend
  plugin is bundled by Vite from `@laikacms/decap-integrations`. The admin route is CSR-only via
  `routeRules: { '/admin': { ssr: false } }`.

## Quick start

```bash
pnpm install   # from the monorepo root
pnpm dev       # in this directory, or: turbo run dev --filter=@laikacms/starter-nuxt-blog
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin> for the CMS editor (dev
auth — no login required).

## Project layout

```
server/
  utils/
    laika.ts              # createEmbeddedLaika singleton (Nitro server-only)
  api/
    posts.get.ts          # GET /api/posts — list published posts
    posts/[slug].get.ts   # GET /api/posts/:slug — fetch single post
    decap/[...path].ts    # Proxy all methods to laika.fetch
utils/
  decap-config.ts         # Shared collection schema (server + client)
layouts/
  default.vue             # Minimal base layout
pages/
  index.vue               # Blog homepage (useFetch /api/posts)
  blog/[slug].vue         # Individual post (useFetch /api/posts/:slug)
  admin.vue               # Decap CMS admin UI (ssr:false, CDN loaded in onMounted)
content/                  # Filesystem content root (git-tracked)
```

## How content reading works

```ts
// server/api/posts.get.ts
import { collectStream } from 'laikacms/compat';
import { laika } from '../utils/laika';

export default defineEventHandler(async () => {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );
  return items.filter(r => r.type === 'published-summary');
});
```

```vue
<!-- pages/index.vue -->
<script setup lang="ts">
const { data: posts } = await useFetch('/api/posts')
</script>
```

`server/utils/laika.ts` is server-only — Nitro never bundles it into the client build. The
`utils/decap-config.ts` collection schema is available on both server and client via Nuxt's
auto-import.

## Decap proxy pattern

In Nuxt, `toWebRequest(event)` (from `h3`) converts the Nitro request event to a standard Web API
`Request`, which `laika.fetch` consumes directly:

```ts
// server/api/decap/[...path].ts
import { toWebRequest } from 'h3';
export default defineEventHandler(event => laika.fetch(toWebRequest(event)));
```

This is the Nuxt equivalent of the Astro
`const handler: APIRoute = ({ request }) => laika.fetch(request)` pattern.

## Auth modes

| Mode     | When to use                                    |
| -------- | ---------------------------------------------- |
| `dev`    | Local development — no credentials required    |
| `custom` | Production — provide `authenticateAccessToken` |

```ts
// server/utils/laika.ts — production example
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

The `body` field is raw markdown. This starter renders it inside `<pre>` for visibility. In
production, pipe it through [@nuxtjs/mdc](https://github.com/nuxt-modules/mdc) or
[remark](https://github.com/remarkjs/remark).

## Deployment

Build with the default Node.js preset:

```bash
pnpm build
node .output/server/index.mjs
```

Set `PORT` to override the default `3000`. Use `NITRO_PRESET` or `nuxt.config.ts` to target other
platforms (Vercel, Cloudflare Workers, AWS Lambda, etc.) — Nitro supports them all via presets.
