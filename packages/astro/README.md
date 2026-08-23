# @laikacms/astro

Astro integration for Laika CMS. Content reaches your pages through Astro's own
[Content Layer](https://docs.astro.build/en/guides/content-collections/) — `getCollection()`,
`getEntry()`, `render()`, Zod schemas — instead of a Laika-specific import protocol.

Three pieces, usable independently:

| Export                   | What it gives you                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `@laikacms/astro/loader` | `documentsLoader()` / `objectsLoader()` for `defineCollection({ loader })`          |
| `@laikacms/astro`        | the `laika()` integration — dev JSON:API, content hot-refresh, types                |
| `@laikacms/astro/live`   | `liveDocumentsLoader()` for `defineLiveCollection()` — runtime reads, draft preview |

## Install

```sh
pnpm add @laikacms/astro laikacms
```

## Quick start

```js
// astro.config.mjs
import { laika } from '@laikacms/astro';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [laika({ dir: 'content', defaultExtension: 'md' })],
});
```

```ts
// src/content.config.ts
import { documentsLoader } from '@laikacms/astro/loader';
import { defineCollection, z } from 'astro:content';

export const collections = {
  posts: defineCollection({
    loader: documentsLoader({ dir: 'content', defaultExtension: 'md' }),
    schema: z.object({
      title: z.string(),
      date: z.coerce.date(),
      description: z.string().optional(),
    }),
  }),
};
```

```astro
---
// src/pages/blog/[...id].astro
import { getCollection, render } from 'astro:content';

export async function getStaticPaths() {
  const posts = await getCollection('posts');
  return posts.map(post => ({ params: { id: post.id }, props: { post } }));
}

const { post } = Astro.props;
const { Content } = await render(post);
---
<h1>{post.data.title}</h1>
<Content />
```

The Astro collection name is the Laika collection by default, so `posts` reads document keys under
`posts/`. A document key of `posts/2026/hello` becomes the entry id `2026/hello`.

## Declaring your fields once

If a catalog already describes your collections — a Decap `config.yml`, a persisted catalog, a
`CatalogProvider` you wrote — drop the Zod schema and pass `z` instead:

```ts
posts: defineCollection({
  loader: documentsLoader({ dir: 'content', catalog: 'decap', collection: 'posts', z }),
});
```

The loader derives the collection's schema from the catalog and generates matching entry types, so
`entry.data` stays fully typed from a single declaration. Where the catalog describes no fields, the
types are inferred from the content instead. Both go through Astro's `Loader.createSchema()`, which
writes them into `.astro/loaders/`.

## Where content comes from

Every loader accepts any `DocumentsRepository`. With no repository given, a filesystem repository
over `dir` is built for you — that is the zero-config path. To read from a running Laika server,
pass a proxy repository; no extra option exists because none is needed:

```ts
import { DocumentsJsonApiProxyRepository } from 'laikacms/documents/jsonapi-proxy';

documentsLoader({
  documents: new DocumentsJsonApiProxyRepository({
    baseUrl: 'https://cms.example.com/api/documents',
    authToken: process.env.LAIKA_TOKEN,
  }),
});
```

## Incremental sync

The loader keeps Astro's content store in step with the repository using the best mechanism the
repository advertises through `getCapabilities()`, and degrades cleanly when it advertises nothing:

| Tier       | Requires                       | Work per build                       |
| ---------- | ------------------------------ | ------------------------------------ |
| `changes`  | a sync token and a change feed | only what changed                    |
| `versions` | version tracking               | list summaries, re-read only changed |
| `digest`   | nothing                        | read all, re-parse only changed      |
| `reload`   | nothing                        | rebuild the store                    |

`sync.strategy` defaults to `'auto'`. The filesystem path lands on `digest`; in dev, edits skip the
listing entirely because the integration pushes changed keys straight into the refresh.

## Serving the API

While `astro dev` runs, the integration mounts Laika's JSON:API at `/__laika` so the Decap admin can
edit content locally. That mount comes from Astro's dev-server hook, which never runs during
`astro build`, so a built site has no route to it.

For a deployment, opt in to a real route. It serves only published content unless you say otherwise:

```js
laika({ dir: 'content', api: { mode: 'route', basePath: '/api/laika', access: 'published' } });
```

`access` is `'published'` (reads of published content only), `'read'` (adds drafts and revisions) or
`'all'` (adds writes). The route needs an adapter and `output: 'server'`.

## Documentation

See the [package reference](https://laikacms.com/docs/reference/packages/astro/) and the
[Astro guide](https://laikacms.com/docs/guides/astro).

## License

MIT
