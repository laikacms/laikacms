# Quickstart: Node.js

By the end of this page you'll have a Node.js server running the Decap CMS admin at `/admin/`,
content stored as files on disk, and a page rendering that content — the full loop: edit → store →
deliver.

| Requirement | Version                 |
| ----------- | ----------------------- |
| Node.js     | ≥ 22 (22 LTS or 24 LTS) |

## New project

```sh
npx laikacli create --starter starter-hono-blog
cd my-laika-app
pnpm dev
```

The [wizard](../cli/create) asks for a directory, title, and which Decap backends/widgets/locales to
register, then scaffolds a Hono blog. Open the printed URL: the blog index links to `/admin/`, where
the Decap admin runs against your local `content/` directory. Write a post, publish it, and it
appears on the index — each post is a file you can open in your editor.

## Add to an existing project

### 1. Install

```sh
pnpm add laikacms @laikacms/server '@hono/node-server@^2' hono
pnpm add -D @laikacms/decap-cms @emotion/react @emotion/styled esbuild
```

(`@laikacms/decap-cms` + Emotion + esbuild are for bundling the admin UI; `@hono/node-server` is
pinned to the major `laikacms` peer-depends on.)

### 2. Create the backend

`createEmbeddedLaika` wires the whole stack — filesystem storage, serializers, catalog, documents,
assets, and the Decap-compatible API — from one options object:

```ts
// src/laika.ts
import { createEmbeddedLaika } from '@laikacms/server/embedded';
import { resolve } from 'node:path';

export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' }, // pre-shared dev token — replace before production
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: [
      {
        name: 'posts',
        label: 'Posts',
        folder: 'posts',
        create: true,
        format: 'json', // required — the laika Decap backend persists JSON-format collections
        fields: [
          { name: 'title', label: 'Title', widget: 'string' },
          { name: 'body', label: 'Body', widget: 'richtext' },
        ],
      },
    ],
  },
});
```

### 3. Mount it

```ts
// src/index.ts
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { laika } from './laika.js';

const app = new Hono();
app.all('/api/decap/*', c => laika.fetch(c.req.raw)); // the whole content API
app.use('/admin/*', serveStatic({ root: './public' })); // the admin shell (next step)

serve({ fetch: app.fetch, port: 3000 });
```

Using Express or plain `http.Server` instead? Those predate the Web API — see the small request
bridge in [Quickstart: Vite → Express bridge](./vite#the-express-bridge).

### 4. Bundle the admin

```ts
// admin/index.ts
import { DecapCmsApp as CMS } from '@laikacms/decap-cms';
import { createLaikaBackend } from '@laikacms/decap-cms/backends/laika';

CMS.registerBackend('laika', createLaikaBackend());
CMS.init(); // reads the config the server seeded (backend.name: laika, api_url: /api/decap)
```

```sh
npx esbuild admin/index.ts --bundle --outfile=public/admin/bundle.js --format=iife --target=es2020
```

Add a `public/admin/index.html` loading `bundle.js`, start the server, and open
`http://localhost:3000/admin/`. Log in with the dev token (`dev-local-laika-token` unless you set
`auth.devToken`) and publish a post.

Prefer a zero-build admin? Load the prebuilt CDN bundle instead — see
[Decap → Serving the admin shell](../decap/admin-shell#loading-from-a-cdn).

### 5. Deliver the content

The same repositories the API uses are available in-process — no HTTP round-trip:

```ts
import { collectStream, runTask } from 'laikacms/compat';
import { laika } from './laika.js';

app.get('/blog/:slug', async c => {
  const post = await runTask(laika.documents.getDocument(`posts/${c.req.param('slug')}`));
  const { title, body } = post.content as { title?: string, body?: string };
  return c.html(`<h1>${title}</h1>\n${body}`);
});
```

That's the loop: Decap wrote a file into `content/posts/`, and your route just served it.

## Next steps

- [Deploy to Production](./deploy) — real auth, persistent volume, hardening checklist
- [Decap → Authentication](../decap/auth) — replace the dev token with OAuth2
- [Backends](../backends/fs) — swap the filesystem for git, S3, or SQL without touching the rest
