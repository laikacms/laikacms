# starter-eleventy-blog

Minimal blog built with [Eleventy (11ty)](https://www.11ty.dev) and LaikaCMS. Demonstrates a
Jamstack pattern:

- **Eleventy SSG** — reads content at build time (and during `--serve` watch) via
  `laika.documents.*` global data files.
- **`createEmbeddedLaika`** — wires up filesystem storage, Decap config syncing, documents repo, and
  the Decap JSON:API fetch handler.
- **Dev server middleware** — `eleventy.config.mjs` hooks the Decap JSON:API into Eleventy's
  built-in dev server so a single `pnpm dev` command covers both the blog and the CMS editor.
- **Decap admin from CDN** — `decap-cms.js` loaded from unpkg; the laika backend plugin is bundled
  by esbuild from `@laikacms/decap-integrations`.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:8080> for the blog and <http://localhost:8080/admin/> for the CMS editor (dev
auth — no login required).

## Project layout

```
src/
  lib/
    decap-config.js     # Shared collection schema (server + admin)
    laika.js            # createEmbeddedLaika singleton
  _data/
    posts.js            # Eleventy data file: loads all posts at build time
  _includes/
    base.njk            # Base layout
  index.njk             # Blog homepage — lists all posts
  blog.njk              # Pagination template — one page per post
  admin-client.ts       # Bundled for browser: registers laika backend
public/
  admin/
    index.html          # Decap admin UI (Decap from CDN)
    bundle.js           # Built from admin-client.ts by esbuild
content/                # Filesystem content root (git-tracked)
eleventy.config.mjs     # Eleventy config + dev-server middleware
```

## How content reading works

Content is loaded at build time by `src/_data/posts.js`:

```js
import { collectStream, runTask } from 'laikacms/compat';
import { laika } from '../lib/laika.js';

// List all published post summaries
const { items: records } = await collectStream(
  laika.documents.listRecordSummaries({
    pagination: { page: 1, perPage: 100 },
    folder: 'posts',
    depth: 1,
    type: 'published',
  }),
);

// Load full content per post
const post = await runTask(laika.documents.getDocument('posts/hello-world'));
console.log(post.content.title); // frontmatter fields
```

The `posts` array is available in every Nunjucks template.

## Dev server architecture

During `pnpm dev`, Eleventy's built-in dev server handles:

- `GET /` and `GET /blog/:slug/` → Eleventy SSG output from `_site/`
- `GET|POST|PUT|DELETE /api/decap/*` → laika.fetch (Decap JSON:API)
- `GET /admin/` → static HTML from `public/admin/index.html`

The middleware in `eleventy.config.mjs` bridges Node.js `http.IncomingMessage` to the Web API
`Request` that `laika.fetch` expects — same adapter pattern as `starter-express-blog`.

## Auth modes

| Mode     | When to use                                    |
| -------- | ---------------------------------------------- |
| `dev`    | Local development — no credentials required    |
| `custom` | Production — provide `authenticateAccessToken` |

```js
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

## TypeScript in data files

Eleventy data files and `eleventy.config.mjs` are plain ESM JavaScript so they can be imported by
Eleventy's Node.js runtime without a transpilation step. If you want TypeScript in data files, run
Eleventy with the tsx loader:

```bash
node --import tsx/esm node_modules/.bin/eleventy --serve
```

Then rename `*.js` to `*.ts` and add `tsx` to `devDependencies`.

## Production deployment

`pnpm build` generates a fully static `_site/` folder. For a self-hosted deployment that also serves
the Decap editor:

1. Deploy `_site/` to any static host (Netlify, Vercel, S3+CloudFront, etc.)
2. Run a separate API server (e.g., the pattern from `starter-express-blog` or `starter-hono-blog`)
   that handles `/api/decap/*` routes and serves `public/admin/`
3. Point the admin's `api_url` at the API server's public URL

For a single-process deployment, combine Eleventy's build output with a Node.js server that serves
static files and the Decap API — the same `laika.fetch` call works in any environment with Node.js
filesystem access.
