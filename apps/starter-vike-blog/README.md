# starter-vike-blog

Minimal blog built with [Vike](https://vike.dev) (formerly `vite-plugin-ssr`) + React and LaikaCMS.
Vike is a framework-agnostic Vite-based SSR engine — it adds file-system routing and server-side
data loading to any Vite project without locking you into a specific frontend framework.

- **`createEmbeddedLaika`** — one call wires up filesystem storage, Decap config syncing, documents
  repo, and the Decap JSON:API fetch handler.
- **`+data.ts` files** — Vike runs these exclusively on the server; they load content via
  `laika.documents.*` and serialise it to JSON for the client. No HTTP round-trip needed.
- **`useData()` from `vike-react`** — accesses the server-loaded data inside React components.
- **Decap admin via `useEffect`** — the admin page bootstraps Decap CMS in the browser only (SSR
  renders `null`; `useEffect` is never run server-side).

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin> for the CMS editor (dev
auth — no login required).

## Project layout

```
pages/
  +config.ts          # Global Vike config — extends vike-react
  index/
    +data.ts          # Server: list posts via laika.documents.listRecordSummaries
    +Page.tsx         # Client+server: renders post list from useData()
  blog/
    @slug/
      +data.ts        # Server: load post via laika.documents.getDocument
      +Page.tsx       # Client+server: renders post content from useData()
  admin/
    +Page.tsx         # Client-only bootstrap of Decap CMS via useEffect
server/
  index.ts            # Express server with Vite dev middleware + Vike renderPage
src/
  decap-config.ts     # Shared collection schema (server + admin)
  laika.ts            # createEmbeddedLaika singleton (server-only)
vite.config.ts        # Vike + React Vite plugins
content/              # Filesystem content root (git-tracked)
public/               # Static assets (uploaded media)
```

## How content reading works

`+data.ts` files are Vike's equivalent of `getServerSideProps` or `routeLoader$`. They run
server-side on every request and return typed data:

```ts
// pages/index/+data.ts
import { collectStream } from 'laikacms/compat';
import { laika } from '../../src/laika.js';

export async function data() {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );
  return { posts: items.filter(r => r.type === 'published-summary') };
}

export type Data = Awaited<ReturnType<typeof data>>;
```

In the React component:

```tsx
// pages/index/+Page.tsx
import { useData } from 'vike-react/useData';
import type { Data } from './+data.js';

export default function Page() {
  const { posts } = useData<Data>(); // typed, server-populated
  return <ul>{posts.map(p => <li key={p.key}>{p.key}</li>)}</ul>;
}
```

## Auth modes

| Mode     | When to use                                    |
| -------- | ---------------------------------------------- |
| `dev`    | Local development — no credentials required    |
| `custom` | Production — provide `authenticateAccessToken` |

## Build & deploy

```bash
vite build              # builds client + server bundles into dist/
NODE_ENV=production tsx server/index.ts  # serves dist/ + /api/decap/*
```

Swap `FileSystemStorageRepository` in `createEmbeddedLaika` with a platform adapter (e.g.
`R2StorageRepository` from `laikacms/storage-r2`) for serverless / edge deployment.
