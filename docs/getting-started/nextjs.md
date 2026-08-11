# Quickstart: Next.js

By the end of this page you'll have a Next.js (App Router) project with the Decap admin at `/admin`,
the content API as a route handler, and a page rendering the content.

> There is no Next.js starter template yet, so this quickstart is manual-only — `laika create`
> currently scaffolds the [other stacks](./starters).

## 1. Install and create the backend

```sh
pnpm add laikacms @laikacms/server
```

```ts
// lib/laika.ts
import { createEmbeddedLaika } from '@laikacms/server/embedded';
import { resolve } from 'node:path';

export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' }, // replace before production
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: [{
      name: 'posts',
      label: 'Posts',
      folder: 'posts',
      create: true,
      format: 'json',
      fields: [
        { name: 'title', label: 'Title', widget: 'string' },
        { name: 'body', label: 'Body', widget: 'richtext' },
      ],
    }],
  },
});
```

## 2. Mount the API as a route handler

App Router hands you a Web API `Request` (`NextRequest` extends it), so there's no bridge — pass it
straight through:

```ts
// app/api/decap/[...path]/route.ts
import { laika } from '@/lib/laika';

const handler = (request: Request) => laika.fetch(request);

export { handler as DELETE, handler as GET, handler as POST, handler as PUT };
```

## 3. The admin page

The `/admin` page must be a `'use client'` component that injects the admin script in `useEffect` —
`next/script` with `strategy="beforeInteractive"` does not work for third-party scripts in Server
Components. The fork ships a prebuilt, self-contained CDN bundle with the `laika` backend already
registered:

```tsx
// app/admin/page.tsx
'use client';

import { useEffect } from 'react';

export default function AdminPage() {
  useEffect(() => {
    const script = document.createElement('script');
    // Pin an exact version in production — see Decap → Serving the admin shell
    script.src = 'https://cdn.jsdelivr.net/npm/@laikacms/decap-cms@4/dist/cdn/laika-cms.js';
    script.async = true;
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  return <div id="nc-root" />;
}
```

The bundle boots on load and reads the config the server seeded (`backend.name: laika`,
`api_url: /api/decap`). For a tree-shaken bundle instead of the ~1.8 MB gzipped CDN build, see
[Decap → Serving the admin shell](../decap/admin-shell).

## 4. Deliver the content

Server Components read through the same in-process repositories — no HTTP hop:

```tsx
// app/blog/[slug]/page.tsx
import { laika } from '@/lib/laika';
import { runTask } from 'laikacms/compat';

export default async function Post({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  const { title, body } = post.content as { title?: string, body?: string };
  return (
    <article>
      <h1>{title}</h1>
      <div>{body}</div>
    </article>
  );
}
```

Run `next dev`, open `http://localhost:3000/admin`, log in with the dev token
(`dev-local-laika-token`), publish a post, and visit `/blog/<slug>`.

> **Deploying:** `createEmbeddedLaika` writes to the local filesystem, which is fine in dev and on
> any host with a persistent volume — but serverless filesystems are read-only. For Vercel, swap the
> storage for a remote backend: [Quickstart: Vercel](./vercel).

## Next steps

- [Quickstart: Vercel](./vercel) — the same app on serverless with a git backend
- [Decap → Authentication](../decap/auth) — replace the dev token
- [Deploy to Production](./deploy)
