# Getting Started

If you used to self-host [Decap CMS](https://decapcms.org/) on Netlify's `git-gateway`, that path
got harder once Netlify dropped git-gateway support — you're now looking for something to self-host
in its place. LaikaCMS is that: a Decap-compatible backend (and a general-purpose content API) that
runs on your own infrastructure — Node.js, Cloudflare Workers, AWS Lambda, or anywhere else a Web
API `Request`/`Response` pair works.

This page follows how the product is actually adopted, lowest bar first:

1. **[Client setup](#client-setup-simplest)** — read and write content in the browser, no server.
2. **[Server setup](#server-setup-recommended-default)** — the recommended default for anything
   going to production: secrets stay off the client, you own authentication.
3. **[Static compilation](#static-compilation-advanced-build-time)** — bake content into a static
   build at compile time, for sites with no runtime backend at all.
4. **[Growing into more](#growing-into-more)** — swap storage backends, add a database, keep going.

Every server example below is **secure by default**: `decapApi` requires you to state an explicit
`authorize` policy, and there is no implicit "allow everything" fallback. If you only remember one
thing from this page, remember that — the old insecure `buildJsonApi({ repo })` one-liner from
earlier LaikaCMS docs is now a clearly-flagged
[advanced/reference page](./advanced/raw-storage-api), not the lead.

## Installation

```bash
pnpm add laikacms
```

## Client setup (simplest)

For prototyping, demos, or content that's genuinely local to the browser (drafts, user preferences,
offline scratch content), read and write directly in the browser with `WebStorageRepository` — no
server involved at all.

```typescript
import { runTask } from 'laikacms/compat';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { WebStorageRepository } from 'laikacms/storage-web';

const repo = new WebStorageRepository({
  storage: localStorage, // or sessionStorage, or an in-memory shim for SSR/tests
  serializerRegistry: { json: jsonSerializer },
  defaultExtension: 'json',
});

await runTask(repo.createObject({ key: 'draft', type: 'object', content: { title: 'Hello' } }));
const draft = await runTask(repo.getObject('draft'));
```

> [!WARNING]
> The Web `Storage` API (`localStorage`/`sessionStorage`) is **world-readable to any script running
> on the same origin** — it has no access control of its own, and every write it accepts is
> inherently unauthenticated (there's no server in the loop to check who's writing). Never store
> credentials, API keys, or other secrets here. It's fine for local drafts and scratch content; it
> is not a substitute for the Server section below once other people need to read or write the same
> content.

<!-- STACKBLITZ_EMBED: client-vite-react -->

### Reading public content with no backend

If your content already lives in a public GitHub repository and you only need to **read** it,
`GithubCdnStorageRepository` serves it straight from jsDelivr's CDN — no GitHub token, no
`@octokit/*` dependency, no server:

```typescript
import { runTask } from 'laikacms/compat';
import { GithubCdnStorageRepository } from 'laikacms/storage-github-cdn';
import { jsonSerializer } from 'laikacms/storage-serializers-json';

const repo = new GithubCdnStorageRepository({
  owner: 'my-org',
  repo: 'my-content-repo',
  branch: 'main', // optional — defaults to the repo's default branch
  serializerRegistry: { json: jsonSerializer },
});

const post = await runTask(repo.getObject('posts/hello-world'));
```

This repository is **read-only** — every mutating method (`createObject`, `updateObject`,
`removeAtoms`, …) rejects. jsDelivr also caches responses for hours, so treat it as "mostly static
public content," not live editing.

### Writing beyond the browser

`WebStorageRepository` writes stay on the visitor's device. The moment content needs to be shared,
durable, or moderated, writes have to go through a server you control — call your own `decapApi` (or
`buildJsonApi`) endpoint with a `fetch` request carrying a real credential, the same way any other
authenticated client would. See [Server setup](#server-setup-recommended-default) next.

## Server setup (recommended default)

This is the recommended default for anything beyond a local prototype: secrets (API tokens, session
keys) stay on the server, and you decide exactly who can read or write what.

```typescript
import { decapApi } from '@laikacms/decap/decap-api';
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { DefaultContentBaseSettingsProvider } from 'laikacms/contentbase-settings-default';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { jsonSerializer } from 'laikacms/storage-serializers-json';

const storage = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');
const settings = new DefaultContentBaseSettingsProvider({ storage });
const documents = new ContentBaseDocumentsRepository(storage, settings);
const assets = new ContentBaseAssetsRepository(storage, settings);

const api = decapApi({
  documents,
  storage,
  assets,
  // Required: establishes WHO the caller is. Throw to fail closed on a bad token.
  authenticateAccessToken: async token => {
    const session = await db.sessions.findByAccessToken(token);
    if (!session) throw new Error('Invalid session');
    return db.users.findById(session.userId);
  },
  // Required: decides WHAT they may do. No implicit default — you must state
  // the policy. Return false, or throw, to deny (fails closed).
  authorize: ctx => ctx.operation === 'read', // read-only for now; see below
});

export default { fetch: api.fetch };
```

`decapApi` never falls back to an open policy: omit `authorize` and it's a type error, and a policy
that throws is treated as a denial rather than crashing the request open. Compare this to the
[raw `buildJsonApi` primitive](./advanced/raw-storage-api), which ships with no auth at all — that's
exactly why it's no longer the lead here.

### Public reads, gated writes

Partially-public content — reads for anyone, writes for editors — is one branch in `authorize`:

```typescript
declare module '@laikacms/decap/decap-api' {
  interface User {
    roles: string[];
  }
}

const api = decapApi({
  documents,
  storage,
  assets,
  authenticateAccessToken: yourValidator, // returns { id, email, roles, … }
  authorize: ctx => {
    if (ctx.operation === 'read') return true; // anyone authenticated may read
    if (ctx.operation === 'delete') return ctx.user.roles.includes('admin'); // admins only
    return ctx.user.roles.includes('editor'); // editors may create/update/publish
  },
});
```

`ctx` also carries `ctx.method` (upper-cased HTTP method) and `ctx.request` (the raw `Request`) for
policies that need to branch on something the parsed fields don't cover — see
[Authentication → Authorization with `authorize`](./decap/auth#authorization-with-authorize) for the
full `AuthorizeContext` shape and more role-based examples.

### A real login server

Don't hand-roll session storage — `decapOauth2` (`@laikacms/decap/decap-oauth2`) is a self-contained
PKCE OAuth2 server (email/password, optional passkey/WebAuthn, optional TOTP 2FA) you run alongside
`decapApi` in the same app. See
[Authentication → Production auth with `decap-oauth2`](./decap/auth#production-auth-with-decap-oauth2)
for the full Hono/Express wiring.

### Any runtime

`decapApi(...)` returns `{ fetch(request: Request): Promise<Response> }` — standard Fetch API, no
framework lock-in. Drop it into Hono (`app.all('/api/decap/*', c => api.fetch(c.req.raw))`), a plain
Node.js server via `@hono/node-server`, a Cloudflare Worker's `fetch` handler, or an AWS Lambda
behind a Fetch-adapter (Lambda Function URLs, `@hono/aws-lambda`, etc.) unchanged. See
[Framework setup notes](./decap/frameworks) for the exact bridge each framework needs (several, like
Express and plain `http.Server`, need a small manual bridge since they predate the Web API).

<!-- STACKBLITZ_EMBED: server-hono-node -->

For the complete walkthrough — installing packages, writing `admin/config.yml`, running the Decap
admin locally, and deploying — start at
[Self-Hosting Quickstart (FileSystem + Decap)](./decap/quickstart-fs).

## Static compilation (advanced, build-time)

If your site has no runtime backend at all — a fully static build, deployed as plain files — you can
compile content into the bundle at build time instead of serving it over the network. This is not a
core concern for most newcomers; reach for it once you already know you want a static site.

`@laikacms/vite-plugin` loads content through a `laika:` protocol at build time, one ES module per
item:

```ts
// vite.config.ts
import { laikacms } from '@laikacms/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [laikacms({ dir: 'content' })],
});
```

```ts
// app code
import { $key, body, title } from 'laika:doc/posts/hello';
import site from 'laika:store/config/site';
```

Importing only `{ title }` tree-shakes `body` out of the bundle — each field is an independent
export. `import.meta.glob('laika:doc/posts/*', { import: 'title', eager: true })` expands the
`laika:` protocol at build time for collection listings. See the
[`@laikacms/vite-plugin` README](https://github.com/laikacms/laikacms/blob/develop/packages/vite-plugin/README.md)
for the MDX body-chunk pipeline, hot reload, and generated TypeScript types.

### Remote sources

The default filesystem repository is only the default — pass any `StorageRepository` (R2, the GitHub
CDN repository from [Client setup](#reading-public-content-with-no-backend), your own), and the
plugin still compiles each item into a chunk at build time:

```ts
import { laikacms } from '@laikacms/vite-plugin';
import { GithubCdnStorageRepository } from 'laikacms/storage-github-cdn';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { defineConfig } from 'vite';

const storage = new GithubCdnStorageRepository({
  owner: 'my-org',
  repo: 'my-content-repo',
  serializerRegistry: { json: jsonSerializer },
});

export default defineConfig({
  plugins: [laikacms({ storage })],
});
```

<!-- STACKBLITZ_EMBED: static-vite-remote-source -->

### Without Vite

Building with a non-Vite static site generator (Next.js SSG, Astro's non-Vite adapters, a plain
Node.js build script)? Skip the plugin and call the repository directly at build time with the
`laikacms/compat` Promise bridge, so the build script never has to import `effect`:

```ts
// scripts/build-content.ts
import { collectStream, runTask } from 'laikacms/compat';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { jsonSerializer } from 'laikacms/storage-serializers-json';

const storage = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');

const post = await runTask(storage.getObject('posts/hello-world'));
const { items: posts } = await collectStream(
  storage.listAtoms('posts', { depth: 1, pagination: {} }),
);
```

Write the result to wherever your generator reads its static data from (a JSON file, an in-memory
cache during the build, etc.).

## Growing into more

Everything above shares the same `StorageRepository` contract, so none of it is a dead end:

- **Custom repositories** — implement `StorageRepository` once and every layer above it (documents,
  assets, `decapApi`, the Vite plugin) works unchanged. See
  [Repositories](../concepts/repositories).
- **Mix databases and git** — `laikacms/documents-drizzle` and `laikacms/storage-drizzle` back some
  collections with a real database while others stay filesystem/git-backed, all behind the same
  `decapApi`/documents API.
- **No lock-in** — swapping `FileSystemStorageRepository` for R2, S3, WebDAV, or a database is a
  constructor change, not a rewrite. See [Architecture](../concepts/architecture) for how the
  domain/impl/api layers fit together.

## Next steps

- [Decap Integration](./decap/) — the full Decap CMS wiring: quickstart, auth, admin shell, widgets
- [Authentication](./decap/auth) — API keys, SSR guards, logging, OAuth2, the hosted gateway
- [Advanced: the raw Storage API](./advanced/raw-storage-api) — `buildJsonApi`, the low-level
  primitive, secure it yourself
- [Architecture](../concepts/architecture) — design patterns
- [JSON:API Reference](../reference/json-api/) — endpoints
- [Packages](../reference/packages) — all packages
- [Deployment](./deployment) — production setup
