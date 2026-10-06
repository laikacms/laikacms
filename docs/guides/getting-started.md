# Getting Started

Laika's core is one package, `laikacms`. Everything starts from a **storage repository**: an object
that reads and writes content in one backend (the filesystem, R2, a database, a git host, the
browser) behind one shared interface. This page walks through that core: create a repository, read
and write content, list a folder, swap the backend, and serve it all over HTTP.

## Installation

```bash
pnpm add laikacms
```

`laikacms` runs anywhere modern JavaScript runs: Node.js, Bun, Deno, Cloudflare Workers, and the
browser. Import only the subpaths you use.

## Create a repository

A repository needs three things: where the content lives, the serializers it may read and write, and
the file extension new objects get.

```typescript
import { jsonSerializer } from 'laikacms/serializers/json';
import { FileSystemStorageRepository } from 'laikacms/storage/fs';

const repo = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');
```

Keys never include the extension: the object `posts/hello` is stored as
`./content/posts/hello.json`. Serializers for YAML, Markdown with frontmatter, and raw files live
next to the JSON one (`laikacms/serializers/yaml`, `…/markdown`, `…/raw`).

## Write and read objects

Repository methods return a [`LaikaTask`](../reference/api/laikacms/core/namespaces/LaikaTask/).
[`runTask`](../reference/api/laikacms/compat/functions/runTask) from `laikacms/compat` runs one and
gives you a Promise, so you don't need to know Effect to get started.

```typescript
import { runTask } from 'laikacms/compat';

await runTask(repo.createObject({ key: 'posts/hello', content: { title: 'Hello, Laika' } }));

const post = await runTask(repo.getObject('posts/hello'));
console.log(post.content.title); // "Hello, Laika"

await runTask(repo.updateObject({ key: 'posts/hello', content: { title: 'Hello again' } }));
```

A failed task rejects with a typed
[`LaikaError`](../reference/api/laikacms/core/errors/classes/LaikaError). Check its `code` (for
example `not_found`) instead of matching on the message:

```typescript
try {
  await runTask(repo.getObject('posts/missing'));
} catch (error) {
  if (error.code === 'not_found') {
    // render a 404
  }
}
```

## List a folder

Listings are streams, so a large folder never has to fit in memory at once.
[`collectStream`](../reference/api/laikacms/compat/functions/collectStream) drains one into an
array:

```typescript
import { collectStream } from 'laikacms/compat';

const { items } = await collectStream(repo.listAtoms('posts', { depth: 1, pagination: {} }));

for (const atom of items) {
  console.log(atom.key, atom.type); // "posts/hello object"
}
```

An **atom** is anything in the tree: an object or a folder. `depth` controls how far the listing
recurses, and `pagination` accepts offset, page, or cursor (`before` / `after`) styles, depending on
what the backend supports. See [Content Model](../concepts/content-model) for the full shape.

### Recoverable warnings

Some operations partly fail but still produce a usable result, for example a listing that skipped
one corrupt file. Those come back as warnings next to the result instead of failing the call. Pass
`onProgress` to see them:

```typescript
const { items } = await collectStream(repo.listAtoms('posts', { depth: 1, pagination: {} }), {
  onProgress(meta) {
    if (meta._tag === 'RecoverableError') console.warn(meta.error.code, meta.error.message);
  },
});
```

Without `onProgress`, warnings are dropped.

## Swap the backend

Every backend implements the same
[`StorageRepository`](../reference/api/laikacms/storage/classes/StorageRepository) interface, so
switching is a constructor change. The code that reads and writes content stays the same.

```typescript
// Cloudflare R2, from inside a Worker
import { R2StorageRepository } from 'laikacms/storage/r2';

const repo = new R2StorageRepository(env.CONTENT_BUCKET, { json: jsonSerializer }, 'json');
```

```typescript
// The browser's localStorage: no server at all
import { WebStorageRepository } from 'laikacms/storage/web';

const repo = new WebStorageRepository({
  storage: localStorage,
  serializerRegistry: { json: jsonSerializer },
  defaultExtension: 'json',
});
```

> [!WARNING]
> Any script on the same origin can read and write `localStorage`. Use it for local drafts and
> scratch content, never for credentials or shared content.

[Adapters](../adapters/) lists every backend: git hosts, object storage, SQL databases, the
filesystem, and the browser.

<!--@include: ../.vitepress/adapters/logos.md-->

## Serve it over HTTP

[`buildJsonApi`](../reference/api/laikacms/storage/api/functions/buildJsonApi) turns any storage
repository into a [JSON:API](../reference/json-api/) handler. It returns a standard
`fetch(request): Promise<Response>` function, so it runs on any runtime that speaks the Fetch API.

```typescript
import { allowAll } from 'laikacms/json-api';
import { jsonSerializer } from 'laikacms/serializers/json';
import { buildJsonApi } from 'laikacms/storage/api';
import { FileSystemStorageRepository } from 'laikacms/storage/fs';

const repo = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');
const api = buildJsonApi({ repo, authorize: allowAll });

export default { fetch: api.fetch };
```

`authorize` is required. There is no implicit "allow everything" default:
[`allowAll`](../reference/api/laikacms/json-api/functions/allowAll) is the explicit way to say a
surface is intentionally open, and it's only safe on a local dev server or behind something that
already authenticated the request.

`authorize` runs once for every action, before the repository is touched. It receives the action and
the original `Request`. Return `true` to allow it, or `false` to deny it with a 403. A read-only API
is an allow-list of read actions:

```typescript
const READS = new Set([
  'getCapabilities',
  'readOpenApi',
  'listAtoms',
  'listAtomSummaries',
  'getObject',
  'getFolder',
  'getAtom',
]);

const api = buildJsonApi({ repo, authorize: ({ action }) => READS.has(action) });
```

The handler also serves its own OpenAPI spec, so any HTTP client or LLM tool can discover the API.

## Using Effect directly

`laikacms` is built on [Effect](https://effect.website/). If your app already uses Effect, skip the
Promise bridge and run tasks inside your own program with
[`LaikaTask.runValue`](../reference/api/laikacms/core/namespaces/LaikaTask/functions/runValue). Add
`effect` as a direct dependency (`pnpm add effect`) so your code can import it:

```typescript
import { Effect } from 'effect';
import { LaikaTask } from 'laikacms/core';

const program = Effect.gen(function*() {
  const post = yield* LaikaTask.runValue(repo.getObject('posts/hello'));
  return post.content.title;
});
```

## Next steps

- [Repositories](../concepts/repositories): the repository pattern, and how to write your own
- [Content Model](../concepts/content-model): atoms, folders, the `body` convention, change tracking
- [Architecture](../concepts/architecture): how the storage, documents, and API layers fit together
- [Adapters](../adapters/): every supported backend
- [JSON:API Reference](../reference/json-api/): every endpoint
- [Imports](../reference/imports): every import path and its install command
