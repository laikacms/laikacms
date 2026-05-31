# starter-remix-blog

Minimal blog built with [Remix](https://remix.run) and LaikaCMS. Demonstrates the canonical embedded
pattern adapted for Remix's loader/action model:

- **`createEmbeddedLaika`** in `app/lib/laika.server.ts` — one call wires up filesystem storage,
  Decap config syncing, documents repo, and the Decap JSON:API fetch handler.
- **`laika.documents.*` via `laikacms/compat`** — `runTask` / `collectStream` in Remix loaders give
  you Promise-friendly access to content. Remix passes the raw `Request` to `action` and `loader`,
  so the Decap proxy is a one-liner.
- **Decap admin from CDN** — `decap-cms.js` loaded dynamically in `useEffect`; the laika backend
  plugin is bundled by Vite from `@laikacms/decap-integrations`. The admin route lives outside the
  `_blog` layout group so Decap gets a clean body.

## Quick start

```bash
pnpm install   # from the monorepo root
pnpm dev       # in this directory, or: turbo run dev --filter=@laikacms/starter-remix-blog
```

Open <http://localhost:5173> for the blog and <http://localhost:5173/admin> for the CMS editor (dev
auth — no login required).

## Project layout

```
app/
  lib/
    decap-config.ts        # Shared collection schema (server + client)
    laika.server.ts        # createEmbeddedLaika singleton (.server.ts = server-only)
  routes/
    _blog.tsx              # Layout for blog pages (<main> wrapper)
    _blog._index.tsx       # / — homepage, lists published posts
    _blog.blog.$slug.tsx   # /blog/:slug — individual post
    admin.tsx              # /admin — Decap CMS admin (no blog layout)
    api.decap.$.tsx        # /api/decap/* — resource route, proxies to laika.fetch
  root.tsx                 # HTML shell (html/head/body/Scripts)
content/                   # Filesystem content root (git-tracked)
```

## How content reading works

```ts
// app/routes/_blog._index.tsx
import { collectStream } from 'laikacms/compat';
import { laika } from '~/lib/laika.server';

export async function loader() {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );
  return json({ posts: items.filter(r => r.type === 'published-summary') });
}
```

`app/lib/laika.server.ts` has the `.server.ts` extension — Vite/Remix guarantees it is never bundled
into the client build. `app/lib/decap-config.ts` has no `.server.` suffix and is safe in both server
and client code.

## Decap proxy pattern

Remix's `loader` and `action` both receive the raw Web API `Request`, which `laika.fetch` consumes
directly:

```ts
// app/routes/api.decap.$.tsx
export function loader({ request }) {
  return laika.fetch(request);
}
export function action({ request }) {
  return laika.fetch(request);
}
```

`loader` handles GET/HEAD; `action` handles POST/PUT/DELETE/PATCH.

## Admin layout isolation

The admin route (`admin.tsx`) is in the root route group, not the `_blog` layout group, so the
`<main>` wrapper from `_blog.tsx` doesn't apply. Decap CMS renders directly into `document.body`
after `useEffect` fires on the client.

## Auth modes

| Mode     | When to use                                    |
| -------- | ---------------------------------------------- |
| `dev`    | Local development — no credentials required    |
| `custom` | Production — provide `authenticateAccessToken` |

```ts
// app/lib/laika.server.ts — production example
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
production, pipe it through [remark](https://github.com/remarkjs/remark) or use
[remix-utils](https://github.com/sergiodxa/remix-utils).

## Deployment

```bash
pnpm build
pnpm start   # or: node ./build/server/index.js
```

The default Remix build targets Node.js. Use `@remix-run/cloudflare` or `@remix-run/vercel` adapters
for edge deployment.
