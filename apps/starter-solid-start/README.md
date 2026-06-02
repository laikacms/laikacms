# `@laikacms/starter-solid-start`

A **SolidStart** SSR blog with embedded LaikaCMS. The SSR counterpart to `starter-vite-solid-spa` —
same Solid idioms, but full-stack with file-based routing.

## Stack

- SolidStart 1 (Vinxi + Nitro under the hood) + Solid Router
- `laikacms` — FileSystem storage + ContentBase document model
- `@laikacms/decap-integrations/embedded` — `createEmbeddedLaika`, `minimalBlogConfig`,
  `decapAdminHtml`

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-solid-start dev
```

Open:

- `http://localhost:3000` — public blog
- `http://localhost:3000/admin` — Decap CMS admin

## Layout

```
apps/starter-solid-start/
├── app.config.ts                          # SolidStart / Vinxi config
├── content/posts/hello-world.md
├── src/
│   ├── app.tsx                            # Router root with shared chrome
│   ├── entry-client.tsx
│   ├── entry-server.tsx                   # SSR document shell
│   ├── server/
│   │   └── laika.ts                       # createEmbeddedLaika
│   └── routes/
│       ├── index.tsx                      # / — query/createAsync loader
│       ├── posts/[slug].tsx               # /posts/:slug — query/createAsync
│       ├── admin.ts                       # /admin — decapAdminHtml
│       └── api/decap/[...path].ts         # /api/decap/* → laika.fetch
└── tsconfig.json
```

## SolidStart's data-loading idiom

```ts
const getPosts = query(async (): Promise<PostListItem[]> => {
  'use server';
  // server-only body
}, 'posts');

export default function Home() {
  const posts = createAsync(() => getPosts());
  return <Show when={posts()}>{/* ... */}</Show>;
}
```

`'use server'` tags the function body as server-only — at build time it's stripped from the client
bundle. `createAsync` is the resource primitive that handles loading states / streaming / hydration.

## Production hardening

Same checklist as the other starters. See [`docs/starters.md`](../../docs/starters.md).
