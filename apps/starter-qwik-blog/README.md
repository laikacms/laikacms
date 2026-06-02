# `@laikacms/starter-qwik-blog`

A **Qwik City** SSR blog powered by **LaikaCMS** with the embedded **Decap CMS** admin at
`/admin.html`. Content is stored on the local filesystem as markdown files.

The interesting thing about this starter: **resumability**. Qwik doesn't hydrate. It serializes app
state into the HTML at render time and lazily loads JS only on interaction. The first-paint JS
payload for the public blog is effectively zero.

## Stack

- Qwik City 1.13 + Qwik 1.13
- `laikacms` — FileSystem storage + ContentBase document model
- `@laikacms/decap-integrations/embedded` — `createEmbeddedLaika` + `minimalBlogConfig`
- Decap CMS shell served as a static file from `public/admin.html`

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-qwik-blog dev
```

Open:

- `http://localhost:3000` — public blog
- `http://localhost:3000/admin.html` — Decap CMS admin

## Layout

```
apps/starter-qwik-blog/
├── vite.config.ts
├── content/posts/hello-world.md
├── public/admin.html                    # Decap CMS shell (static)
├── src/
│   ├── root.tsx                         # QwikCityProvider + RouterOutlet
│   ├── entry.ssr.tsx                    # server render entry
│   ├── server/
│   │   └── laika.ts                     # createEmbeddedLaika
│   └── routes/
│       ├── layout.tsx                   # shared header / nav
│       ├── index.tsx                    # / — routeLoader$ for posts list
│       ├── posts/[slug]/index.tsx       # /posts/:slug — routeLoader$
│       └── api/decap/[...path]/index.ts # /api/decap/* → laika.fetch
└── tsconfig.json
```

## How `routeLoader$` differs from other SSR loaders

| Framework       | Server data fetch                                                       |
| --------------- | ----------------------------------------------------------------------- |
| Next App Router | `async` server component body                                           |
| Remix/RR v7     | `export async function loader(...)`                                     |
| SvelteKit       | `+page.server.ts` `export async function load(...)`                     |
| Nuxt            | `useFetch('/api/...')` (data layer abstraction)                         |
| TanStack Start  | `createServerFn().handler(...)` + `loader: () => …`                     |
| **Qwik City**   | `routeLoader$(async (event) => …)` — serialized into HTML, no hydration |

## Production

Same hardening checklist as the other starters. Qwik specifically: pick an adapter
(`@builder.io/qwik-city/adapters/node`, `cloudflare-pages`, `vercel-edge`, etc.) and run the
appropriate `build.server` script.

See [`docs/starters.md`](../../docs/starters.md).
