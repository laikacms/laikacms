# @laikacms/vite-plugin

A [Vite](https://vitejs.dev) / [Rolldown](https://rolldown.rs) plugin that loads
[Laika CMS](https://github.com/laikacms/laikacms) content as **ES modules** at build time.

Import content through the `laika:` protocol and each item is read from the documents or storage
repository and emitted as a module with **one named export per field**. Because content is inlined
at build time, this is the default and primary mode: a fully static, **client-only build** — no
server, no JSON:API, nothing to deploy alongside your app. There's also an opt-in dev-server-only
"local mode" that mounts a real JSON:API for tools that need one — see [Local mode](#local-mode).

## Install

```sh
npm install -D @laikacms/vite-plugin laikacms
```

Requires Vite `>=8` (Rolldown-based). Works with `rolldown` directly too.

## Usage

```ts
// vite.config.ts
import { laikacms } from '@laikacms/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [laikacms({ dir: 'content' })],
});
```

```ts
// app code — read a single document
import { $key, body, title } from 'laika:doc/posts/hello';

// or a storage object
import site from 'laika:store/config/site';
```

Each content item becomes a module:

```js
// laika:doc/posts/hello
export const title = 'Hello world';
export const date = '2026-01-02';
export const body = '# Hello…';
export const $key = 'posts/hello'; // repository metadata is $-prefixed
export const $language = 'en';
export default { title, date, body };
```

Importing `{ title }` drops `body` from the bundle — the exports are independent bindings, so
Rollup/ Rolldown tree-shakes whatever you don't read.

## The `laika:` protocol

`laika:<namespace>/<key>` — the namespace picks the repository:

| Namespace | Repository              | Read via           |
| --------- | ----------------------- | ------------------ |
| `doc`     | documents (ContentBase) | `getDocument(key)` |
| `store`   | storage                 | `getObject(key)`   |

## Local mode

The `laika:` protocol above is build-time-inline and stays the default. Separately, and off by
default, the plugin can mount LaikaCMS's own JSON:API over its repositories while `vite dev` is
running — for a JSON:API client (e.g. the Decap admin) that needs to read and write content against
a real HTTP API in dev instead of a remote backend:

```ts
// vite.config.ts
import { laikacms } from '@laikacms/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [laikacms({ dir: 'content', localApi: true })],
});
```

`localApi: true` mounts, under the default base path `/__laika`:

- `/__laika/storage` — the storage repository's JSON:API (`storage-api`'s `buildJsonApi`)
- `/__laika/documents` — the documents repository's JSON:API (`documents-api`'s `buildJsonApi`)
- `/__laika/assets` — the assets repository's JSON:API (`assets-api`'s `buildAssetsApi`), so Decap
  media uploads in dev land locally
- `/__laika/session` — a trivial stub-identity responder; local mode does no real auth, so every
  request gets the same fixed identity. It exists because `LaikaBackend.authenticate()`
  (`@laikacms/server`) always pings `${apiUrl}/session` to resolve a display identity, even when the
  local backend authenticates with a dummy token.

All three repository-backed sub-APIs serve the same repositories the `laika:` loader reads: by
default a filesystem storage repository built from `dir`, with the documents and assets repositories
derived from it via ContentBase. To serve different ones, pass them through the plugin's
`repositories` option.

Pass an options object instead of `true` to override the base path:

```ts
laikacms({
  dir: 'content',
  localApi: {
    // Base path the storage/documents/assets sub-routes mount under.
    // Default: '/__laika'.
    basePath: '/__laika',
  },
});
```

Local mode is unauthenticated by design and only ever wired up from Vite's `configureServer` hook —
nothing in the `build` phase or `configurePreviewServer` calls it, so a production build has no
route to it by construction. If the dev server isn't bound to loopback (e.g. `--host`), the plugin
logs a warning that the mounted API is reachable, unauthenticated, from the network.

`mountLocalApi` (and its `LaikaLocalApiOptions` type) are also exported directly from
`@laikacms/vite-plugin` for callers who want to mount the same API onto their own dev server
instance rather than going through the `localApi` plugin option.

## `import.meta.glob`

Glob patterns over the protocol are expanded at build time by listing the repository — Vite's native
glob only understands filesystem paths, so this plugin rewrites `laika:` globs itself:

```ts
// A blog index that bundles ONLY each post's title
const titles = import.meta.glob('laika:doc/posts/*', { import: 'title', eager: true });
// → { 'laika:doc/posts/a': 'Title A', 'laika:doc/posts/b': 'Title B', … }

// Lazy variant — dynamic import per entry
const posts = import.meta.glob('laika:doc/posts/*');
// → { 'laika:doc/posts/a': () => import('laika:doc/posts/a'), … }
```

`eager`, `import: '<field>'`, and `!`-prefixed exclusion patterns are supported. `*` matches within
a path segment; `**` matches across segments.

## TypeScript

The plugin generates types for every `laika:` import — and it does so by handing the **real content
data to the TypeScript compiler** and letting it infer the types (no hand-written type text, so the
types can never drift from what you import). Output goes to `.laika/` (git-ignored automatically),
referenced from a one-line `laika-env.d.ts` that is scaffolded at your project root:

```ts
// laika-env.d.ts  (commit this)
/// <reference path="./.laika/types.d.ts" />
```

Make sure your `tsconfig.json` includes it (root `*.d.ts` are included by default). Then
`import { title } from 'laika:doc/posts/hello'` types `title` as whatever the compiler infers from
the actual file. For `import.meta.glob`, a per-collection union type is generated so you can
annotate the value type:

```ts
const posts = import.meta.glob<Posts>('laika:doc/posts/*', { eager: true });
```

## MDX bodies

A markdown-serialized item (`.md`, `.mdx`, `.markdown`) deserializes to its frontmatter fields plus
`body`, the prose. With `mdx: true` that prose is also written out as a real `.mdx` chunk under
`.laika/bodies/`, and the module re-exports the compiled component as `Body`:

```ts
laikacms({ dir: 'content', mdx: true });
```

```mdx
---
badge: Coming soon
heading: A hosted gateway
---

Self-install `laika-gateway`, a multi-tenant Worker.
```

```tsx
import { badge, Body, heading } from 'laika:store/platform';

<Body components={{ code: props => <span className="font-mono" {...props} /> }} />;
```

**This plugin never compiles MDX** and does not depend on it. It emits the chunk; pair it with a
plugin that compiles one — `@mdx-js/rollup`, ahead of your JSX plugin:

```ts
import mdx from '@mdx-js/rollup';

plugins: [
  laikacms({ dir: 'content', mdx: true }),
  { enforce: 'pre', ...mdx() },
  react({ include: /\.(jsx|js|mdx|tsx|ts)$/ }),
];
```

Notes:

- The raw `body` string stays exported, and `Body` is kept **out** of the default export — importing
  the data object never drags the compiled component (or the MDX runtime) in with it.
- Chunks are `.mdx`, so bodies are MDX rather than plain CommonMark: a literal `<` or `{` in prose
  has to be escaped.
- Typing `Body` needs [`@types/mdx`](https://npm.im/@types/mdx) in your project — that is where
  `mdx/types` comes from.
- A content field literally named `Body` is an error: it would shadow this export.

## Hot reload

In `vite dev`, editing content on disk invalidates the matching `laika:` modules and reloads the
page — including the `.mdx` chunk behind `Body`, which is rewritten before the reload is sent. This
is powered by a repository **change channel** (`StorageRepository.subscribeChanges`); the filesystem
repository implements it with a native recursive watch. Repositories without a push channel simply
don't hot-reload. Types regenerate off the same channel.

## Options

```ts
laikacms({
  // Directory the default filesystem repository reads, relative to the Vite
  // project root. Default: 'content'.
  dir: 'content',

  // File extension for keys without one. Default: 'json'.
  // Recognised out of the box: .json, .yaml/.yml, .md/.mdx/.markdown, .raw.
  defaultExtension: 'json',

  // Emit each item's `body` as an .mdx chunk and export it as `Body`.
  // Default: false. Requires an MDX plugin in the chain — see "MDX bodies".
  mdx: false,

  // TypeScript declaration generation. Default: true.
  // Pass an options object for finer control:
  //   { literals: true }    — keep literal types (`'draft'`) instead of widening to `string`.
  //   { debounceMs: 30 }    — coalesce rapid incremental writes (default: 30 ms).
  typegen: true,

  // Dev-server hot reload on content change. Default: true.
  // Pass { coarse: true } to invalidate every laika: module on any change.
  hmr: true,
  // Serializer registry for the default filesystem repository. Overrides the
  // built-in registry (.json / .yaml / .md / .raw). Ignored when `storage` or
  // `repositories` is given (supply serializers to those directly instead).
  // Default: built-in registry.
  // serializers: myRegistry,

  // Mount LaikaCMS's JSON:API while `vite dev` runs so a JSON:API client (e.g.
  // Decap admin) can read and write content locally. Off by default.
  // See "Local mode" above for full options.
  // localApi: true,
});
```

### Bring your own repository

The filesystem repository is only the default. Pass any `StorageRepository` (the documents
repository is derived from it via ContentBase):

```ts
import type { StorageRepository } from 'laikacms/storage';

const storage: StorageRepository = /* r2, s3, webdav, drizzle, … */;
laikacms({ storage });
```

To override the serializer registry for the **default filesystem repository**, pass `serializers`.
This is only relevant when you let the plugin build the FS repository from `dir` — if you supply
`storage` or `repositories`, configure serializers on those objects directly:

```ts
import { jsonSerializer, markdownSerializer } from 'laikacms/storage';

laikacms({
  dir: 'content',
  serializers: { md: markdownSerializer, json: jsonSerializer },
});
```

…or supply both repositories yourself:

```ts
import { createRepositories } from '@laikacms/vite-plugin';

laikacms({ repositories: { storage, documents } });
```

## License

MIT © Sem Postma
