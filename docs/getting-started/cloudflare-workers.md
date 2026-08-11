# Quickstart: Cloudflare Workers

By the end of this page you'll have a Worker serving the content API and the Decap admin at the
edge, with content in Cloudflare storage. Workers have no filesystem, so this quickstart uses
[R2](../backends/r2) — the starter shows the same wiring against D1.

## New project

```sh
npx laikacli create --starter starter-workers-blog
cd my-laika-app
pnpm dev
```

The [wizard](../cli/create) scaffolds a Workers blog that wires `laikaApi` by hand — exactly because
`createEmbeddedLaika` (Node.js + filesystem) is not available at the edge. The admin bundle is
served as a static asset; the API and blog routes run in the Worker.

## Add to an existing Worker

### 1. Install

```sh
pnpm add laikacms @laikacms/server
pnpm add -D @laikacms/decap-cms @emotion/react @emotion/styled esbuild
```

### 2. Wire the API over R2

```ts
// src/index.ts
import { laikaApi } from '@laikacms/server/api';
import { CatalogAssetsRepository } from 'laikacms/assets-catalog';
import { ConventionCatalogProvider } from 'laikacms/catalog-convention';
import { CatalogDocumentsRepository } from 'laikacms/documents-catalog';
import { R2StorageRepository } from 'laikacms/storage-r2';
import { jsonSerializer } from 'laikacms/storage-serializers-json';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const storage = new R2StorageRepository(env.CONTENT_BUCKET, { json: jsonSerializer }, 'json');
    const settings = new ConventionCatalogProvider({ storage });
    const documents = new CatalogDocumentsRepository(storage, settings);
    const assets = new CatalogAssetsRepository(storage, settings);

    const api = laikaApi({
      documents,
      storage,
      assets,
      basePath: '/api/decap',
      authenticateAccessToken: async token => {
        if (token !== env.DEV_TOKEN) throw new Error('Unauthorized'); // dev only — see Deploy
        return { id: 'dev', email: 'dev@local.test' };
      },
      authorize: () => true,
    });

    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/decap')) return api.fetch(request);
    return renderBlog(request, documents); // your routes — see step 4
  },
};
```

```toml
# wrangler.toml
name = "my-laika-app"
main = "src/index.ts"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./public" # serves the pre-built admin bundle

[[r2_buckets]]
binding = "CONTENT_BUCKET"
bucket_name = "content"
```

Construct repositories per request (the bucket binding arrives with `env`) or cache them across
requests like the starter does — both are fine.

### 3. Local dev: miniflare has no local filesystem

`wrangler dev` runs your Worker against a _simulated_ R2 bucket, which starts empty and isn't your
real content. To develop against real local files, run the local storage server and point a
[JSON:API proxy repository](../backends/jsonapi-proxy) at it:

```sh
laika local serve --root ./content --port 3030   # terminal 1
wrangler dev                                     # terminal 2
```

```ts
// dev-only wiring: local files over HTTP instead of simulated R2
import { StorageJsonApiProxyRepository } from 'laikacms/storage-jsonapi-proxy';
const storage = new StorageJsonApiProxyRepository({ baseUrl: 'http://127.0.0.1:3030' });
```

See [`laika local serve`](../cli/serve) for flags.

### 4. Admin and delivery

Bundle the admin with esbuild into `public/admin/` exactly as in
[Quickstart: Node.js](./nodejs#_4-bundle-the-admin) — the `[assets]` block serves it. Then render
content in your Worker routes:

```ts
import { collectStream } from 'laikacms/compat';

const { items } = await collectStream(
  documents.listRecordSummaries({
    pagination: { page: 1, perPage: 100 },
    folder: 'posts',
    depth: 1,
    type: 'published',
  }),
);
```

Open the deployed `/admin/`, publish a post, and your route serves it from R2. Loop closed.

## Next steps

- [Deploy to Production](./deploy) — real auth (`wrangler secret put`), CORS, hardening
- [SQL backend](../backends/sql) — Drizzle on D1 for queryable collections
- [Starter gallery](./starters) — the workers starter's D1 + REST API wiring in full
