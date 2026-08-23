---
title: '@laikacms/astro'
order: 3
---

# @laikacms/astro

Astro integration for Laika CMS. Content reaches your pages through Astro's own Content Layer —
`getCollection`, `getEntry`, `render`, Zod schemas — rather than a Laika-specific import protocol.

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

`astro` is an optional peer dependency (`>=7`).

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
    schema: z.object({ title: z.string(), date: z.coerce.date() }),
  }),
};
```

The Astro collection name is the Laika collection, so `posts` reads document keys under `posts/`. A
key of `posts/2026/hello` becomes the entry id `2026/hello` — use a `[...id]` route so the slash
survives.

## Declaring your fields once

If your collections are already described somewhere — a Decap `config.yml`, a persisted catalog, a
`CatalogProvider` you wrote — you do not need to restate them as a Zod schema. Pass `z` and the
loader derives the schema from the catalog, and generates matching entry types so `entry.data` stays
fully typed:

```ts
import { documentsLoader } from '@laikacms/astro/loader';
import { defineCollection, z } from 'astro:content';

export const collections = {
  posts: defineCollection({
    loader: documentsLoader({ dir: 'content', catalog: 'decap', collection: 'posts', z }),
  }),
};
```

`catalog: 'decap'` is what selects a Decap config as the source; nothing in the loader is
Decap-specific, and `catalog` also accepts a `CatalogProvider` instance. Schema derivation needs an
explicit `collection`, because Astro asks for the schema before the loader runs. An explicit
`schema` on `defineCollection` always wins.

When the catalog describes no fields — a convention catalog, or storage objects, which have no field
list at all — passing `z` still pays off: the loader reads the content and generates entry types
from what is actually there, including nested objects and arrays, marking a field optional when only
some entries carry it. Validation stays permissive in that case, since inferred shape is a
description of today's content, not a rule about it.

Either way the types go through Astro's own `Loader.createSchema()`, which writes them to
`.astro/loaders/<collection>.ts`; nothing is written behind Astro's back.

To skip naming the collections too, `laikaCollections()` enumerates them from the catalog:

```ts
export const collections = await laikaCollections({ dir: 'content', catalog: 'decap', z });
```

This trades static typing for brevity: collection names discovered at runtime cannot be known to
TypeScript, so `entry.data` is `unknown`. Prefer the explicit form unless you have many collections.

## Where content comes from

Every loader accepts any `DocumentsRepository`. With none given, a filesystem repository over `dir`
is built for you. Reading from a running Laika server is not a separate option — it is a different
repository:

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

The loader keeps Astro's content store in step using the best mechanism the repository advertises
through `getCapabilities()`, and degrades cleanly when it advertises none:

| Tier       | Requires                       | Work per build                           |
| ---------- | ------------------------------ | ---------------------------------------- |
| `changes`  | a sync token and a change feed | only what changed                        |
| `versions` | version tracking               | list summaries, re-read only the changed |
| `digest`   | nothing                        | read all, re-parse only the changed      |
| `reload`   | nothing                        | rebuild the store                        |

`sync.strategy` defaults to `'auto'`. The filesystem and Catalog path lands on `digest`, because
`CatalogDocumentsRepository` reports neither optional capability today; it will move up a tier
automatically if that changes. In dev, edits skip listing entirely — the integration pushes the
changed keys straight into the refresh.

## Storage objects

Content with no publication state — settings, navigation, structured page data — is a storage object
rather than a document, and has its own loader:

```ts
import { objectsLoader } from '@laikacms/astro/loader';

export const collections = {
  settings: defineCollection({
    loader: objectsLoader({ dir: 'content', defaultExtension: 'yaml' }),
  }),
};
```

## Live collections

Live collections read per request instead of per build, which is what makes draft preview possible.
They must be declared in `src/live.config.ts` and require an on-demand rendered page, so the project
needs an adapter.

```ts
// src/live.config.ts
import { liveDocumentsLoader } from '@laikacms/astro/live';
import { defineLiveCollection } from 'astro:content';

export const collections = {
  posts: defineLiveCollection({ type: 'live', loader: liveDocumentsLoader({ documents }) }),
};
```

```astro
---
const preview = Astro.url.searchParams.get('preview') === '1';
const { entry, error } = await getLiveEntry(
  'posts',
  preview ? { id: Astro.params.id, type: 'unpublished', status: 'draft' } : { id: Astro.params.id },
);
---
```

The loader stays policy-free: **gating who may see a draft is your application's job.** A missing
entry resolves to `undefined` so Astro raises its own not-found error; any other failure is returned
as `{ error }` with the `LaikaError` code and status intact.

Rendering is off by default here — bundling a markdown parser would put it in the server bundle of
every page that reads a live collection. Pass `render: { mode: 'markdown', markdown }` with a
renderer of your choice.

### Typing a live entry

Astro gives a live loader no `createSchema()` hook — its data type flows only through the loader's
generic — so the integration writes the types instead. It reads the catalog at `astro:config:done`
and emits an augmentation into `.astro/`, and passing an explicit `collection` picks it up:

```ts
// entry.data is { title: string, date: string | Date, draft?: boolean }
liveDocumentsLoader({ documents, collection: 'posts' });
```

A collection the catalog cannot describe is simply not a member, and stays `Record<string, unknown>`
— the same "unknown rather than wrong" position the schema derivation takes on a widget it does not
know. So does omitting `collection`, since the key is then only known at runtime.

Dates are `string | Date` rather than `Date`. Nothing coerces on the live path by default: the
loader hands back whatever the serializer produced, a string from JSON and possibly a `Date` from
YAML front matter. Claiming `Date` would be a lie the checker cannot catch.

Override any of it by augmenting the module yourself — useful when a custom widget resolved to
`unknown` and you know better:

```ts
declare module '@laikacms/astro/live-collections' {
  interface LaikaLiveCollections {
    posts: { title: string, tags: string[] };
  }
}
```

### Validating a live entry

Off by default, and deliberately: a build-time collection is validated once per build, but this runs
on every request. Opt in per loader, passing the catalog to derive the schema from and your own `z`:

```ts
liveDocumentsLoader({
  documents,
  collection: 'posts',
  validate: { catalog, z },
});
```

The schema is derived once per collection, not once per request. A mismatch comes back as
`{ error }` with `ValidationError`'s code, alongside every other failure the loader reports. With
validation on, dates _are_ coerced — the `Date` half of `string | Date` becomes the real one.

## The dev API

The integration mounts Laika's JSON:API at `/__laika` while `astro dev` is running, so the Decap
admin can read and write content locally. It is unauthenticated by design and is mounted only from
Astro's dev-server hook, which never runs during `astro build` — a built site has no route to it.

## Serving the API in production

A built site already gives its published content away, so serving that same content over an API is
not a new disclosure. Writes and drafts are a different matter, so the route is opt-in and read-only
by default:

```js
// astro.config.mjs
laika({
  dir: 'content',
  api: { mode: 'route', basePath: '/api/laika', access: 'published' },
});
```

The route is rendered on demand, so the project needs an adapter and `output: 'server'`; the
integration fails at config time, naming the option, rather than letting Astro's
`NoAdapterInstalled` fire mid-build.

| `access`      | Serves                                                 | Refuses                          |
| ------------- | ------------------------------------------------------ | -------------------------------- |
| `'published'` | published documents, storage/asset reads, capabilities | drafts, revisions, locks, writes |
| `'read'`      | the above plus drafts and revisions                    | every write                      |
| `'all'`       | everything                                             | nothing                          |

`'read'` and `'all'` place no policy of their own in front of the route — put them behind your own
middleware, or an authenticated deployment. The policies are allowlists, so an action added by a
future `laikacms` release is refused until it has been reviewed rather than exposed on upgrade.

Filters are checked, not just action names: under `'published'` a listing that asks for
`filter[type]=unpublished` — or for every type at once — is refused, so drafts cannot leak through a
query parameter.

Because the route is built into the server bundle, it constructs its own repositories from the
serialisable options (`dir`, `catalog`, `defaultExtension`). Passing a live `repositories` or
`storage` instance is an error with `mode: 'route'` — that object cannot cross into the server
bundle. Build the handler yourself instead:

```ts
// src/pages/api/laika/[...path].ts
import { createApiHandler } from '@laikacms/astro/api';

const handler = createApiHandler({ repositories, basePath: '/api/laika', access: 'published' });
export const prerender = false;
export const ALL = ({ request }) => handler(request);
```

Note that Astro's own origin check rejects cross-site non-`GET` requests before the handler sees
them, so an `'all'` deployment written to from another origin needs `security.checkOrigin`
configured accordingly.

For a deployment that needs real authentication rather than a public read, `laikaApi` from
`@laikacms/server/api` takes `authenticateAccessToken` and `authorize` and mounts the same way.
