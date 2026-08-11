# Quickstart: Vite

By the end of this page you'll have a Vite app with the Decap CMS admin editing local content and
your pages rendering it. Two shapes, pick by how your app serves content:

- **SSR / a server in front** → the starter below (Vite + React + Express).
- **Static / content compiled into the bundle** →
  [`@laikacms/vite-plugin`](#the-vite-plugin-static-content) with `laika:` imports.

## New project

```sh
npx laikacli create --starter starter-vite-react-blog
cd my-laika-app
pnpm dev
```

The [wizard](../cli/create) scaffolds a bare Vite SSR + React + Express app — deliberately no
meta-framework, so you can see everything Next.js abstracts away: server-side `renderToString`,
Express request handling, and the Decap proxy. Open `/admin/`, publish a post, and the blog renders
it.

## Add to an existing Vite project

### 1. Install and create the backend

```sh
pnpm add laikacms @laikacms/server
pnpm add -D @laikacms/decap-cms @emotion/react @emotion/styled
```

```ts
// src/laika.ts
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

### 2. The Express bridge

Vite SSR setups typically run behind Express (or Vite's own Connect middleware), which predates the
Web API — so bridge `IncomingMessage` to the `Request` that `laika.fetch` expects:

```ts
// server.ts
import { Readable } from 'node:stream';
import { laika } from './src/laika.js';

app.all('/api/decap/*path', async (req, res) => {
  const url = `${req.protocol}://${req.headers.host}${req.originalUrl}`;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const bodyBuffer = chunks.length ? Buffer.concat(chunks) : null;

  const webRes = await laika.fetch(
    new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: bodyBuffer
        ? bodyBuffer.buffer.slice(
          bodyBuffer.byteOffset,
          bodyBuffer.byteOffset + bodyBuffer.byteLength,
        ) as ArrayBuffer
        : null,
      duplex: 'half',
    } as RequestInit),
  );

  res.status(webRes.status);
  webRes.headers.forEach((value, key) => res.setHeader(key, value));
  if (webRes.body) Readable.fromWeb(webRes.body as never).pipe(res);
  else res.end();
});
```

> TypeScript 6 note: `Request` bodies require a concrete `ArrayBuffer` — hence the
> `.buffer.slice(byteOffset, …)` dance instead of passing the `Buffer` directly.

### 3. Admin and delivery

Bundle the admin exactly as in [Quickstart: Node.js](./nodejs#_4-bundle-the-admin) (Vite can build
it as a second entry, or use esbuild), then render content in your SSR routes via `laika.documents`
with `runTask`/`collectStream` from `laikacms/compat`.

## The Vite plugin (static content)

For static sites, skip the server: `@laikacms/vite-plugin` compiles content into the bundle at build
time through the `laika:` protocol, one tree-shaken ES module per item:

```ts
// vite.config.ts
import { laikacms } from '@laikacms/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [laikacms({ dir: 'content' })],
});
```

```ts
// app code — importing only { title } tree-shakes body out of the bundle
import { body, title } from 'laika:doc/posts/hello';
const posts = import.meta.glob('laika:doc/posts/*', { import: 'title', eager: true });
```

Its opt-in `localApi: true` mode mounts a real JSON:API on the dev server for the Decap admin —
content editing in dev, zero runtime backend in production. `dir` is only the default source: pass
any `StorageRepository` (e.g. [GitHub CDN](../backends/github-cdn)) as `storage` and content is
still compiled at build time. Full reference:
[`@laikacms/vite-plugin` README](https://github.com/laikacms/laikacms/blob/develop/packages/vite-plugin/README.md).

## Next steps

- [Deploy to Production](./deploy)
- [Decap → Authentication](../decap/auth) — replace the dev token
- [Starter gallery](./starters) — the astro-blog starter shows the plugin + `localApi` shape
