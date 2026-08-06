# Self-Hosting Quickstart: FileSystem + Decap CMS

This guide walks you through running LaikaCMS on a plain Node.js server using filesystem storage
(`laikacms/storage-fs`) and the Laika backend for Decap CMS (`@laikacms/decap`). It is the simplest
possible self-hosted setup — no cloud provider account required.

For a broader overview of the system see [architecture](../../concepts/architecture), and for
Cloudflare Workers or AWS Lambda deployments see [deployment](../deployment).

---

## Prerequisites

| Requirement | Version                 |
| ----------- | ----------------------- |
| Node.js     | ≥ 22 (22 LTS or 24 LTS) |
| npm or pnpm | any recent              |

---

## 1. Install packages

Install the LaikaCMS packages and a Node.js server runtime. Storage repos, document/asset repos, API
factories, and serializers are all subpath exports of the single `laikacms` package. The Decap
integration lives in `@laikacms/decap`:

```bash
# npm — add hono explicitly: §4a's --legacy-peer-deps prunes auto-installed peers, and
# @hono/node-server's type declarations import from hono (needed if you use server.ts).
# Pin @hono/node-server to the major laikacms peer-depends on (currently ^2) — an
# unpinned install can otherwise pull a newer major than laikacms supports and fail
# with an ERESOLVE peer conflict before anything installs.
npm install laikacms @laikacms/decap '@hono/node-server@^2' hono

# pnpm — hono for the same reason: pnpm satisfies @hono/node-server's peer internally, but does
# not expose it at your project root, so a server.ts would not typecheck without it.
# --allow-build: since v10 pnpm refuses to run dependency install scripts unless you allow them,
# and exits non-zero when it skips any — without these flags this command fails outright with
# ERR_PNPM_IGNORED_BUILDS (msgpackr-extract, and esbuild once §4a adds it).
pnpm add --allow-build=esbuild --allow-build=msgpackr-extract \
  laikacms @laikacms/decap '@hono/node-server@^2' hono
```

> **Version pin:** `laikacms` peer-depends on `@hono/node-server@^2.0.10` (see its `package.json`).
> Pinning the major here keeps a bare `npm install`/`pnpm add` from picking up a future
> `@hono/node-server` major before `laikacms` declares support for it — check `laikacms`'s
> `peerDependencies` if you hit an ERESOLVE here.

> pnpm records the `--allow-build` grants in a `pnpm-workspace.yaml` it writes next to your
> `package.json`, so you only pass the flags once. `pnpm approve-builds` is the interactive
> equivalent.

| Package             | Purpose                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms`          | Core: storage repos, document/asset repos, API factories, serializers (subpaths).                                                              |
| `@laikacms/decap`   | Decap-compatible API server + Laika backend for the browser-side Decap CMS admin.                                                              |
| `@hono/node-server` | Runs a Web-standard `fetch` handler on Node.js.                                                                                                |
| `hono`              | Peer dependency of `@hono/node-server@2`. §4a's `--legacy-peer-deps` prunes npm's auto-installed copy; also needed to typecheck a `server.ts`. |

> **Subpath exports:** the snippet below imports from `laikacms/storage-fs`,
> `laikacms/documents-contentbase`, `laikacms/assets-contentbase`,
> `laikacms/contentbase-settings-default`, and `laikacms/storage-serializers-json`. These are
> subpath exports of the single `laikacms` package — there is no separate `@laikacms/storage-fs`
> package on npm. See [packages.md](../../reference/packages) for the full list of subpaths.

> **Other formats:** swap `laikacms/storage-serializers-json` for
> `laikacms/storage-serializers-yaml` if you prefer YAML files, and change `'json'` to `'yaml'` in
> the snippet below.
>
> **Supported Decap collection formats:** the storage layer above ships serializers for JSON, YAML,
> markdown-frontmatter, and raw text — but the bundled `@laikacms/decap` Decap admin backend (§4)
> currently only sends structured `content` to the documents API for collections with
> **`format: json`**. Decap's default when a collection omits `format:` is markdown-frontmatter,
> which this backend does not yet support — saving such an entry fails fast with a clear client-side
> error rather than a raw file write. Always set `format: json` explicitly on every collection in
> `admin/config.yml`, as the example in §4d does.

---

## 2. Create the Node.js server

Create `server.mjs` (or `server.ts` if you have a TypeScript build step):

```js
// server.mjs
import { serve } from '@hono/node-server';
import { decapApi } from '@laikacms/decap/decap-api';
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { DefaultContentBaseSettingsProvider } from 'laikacms/contentbase-settings-default';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { jsonSerializer } from 'laikacms/storage-serializers-json';

// Replace this with a real secret in production (e.g. from process.env).
const DEV_TOKEN = 'dev-secret-change-me';

// 1. Build a serializer registry — maps file extensions to serializers.
const serializerRegistry = {
  json: jsonSerializer,
};

// 2. Instantiate the storage repository.
//    Constructor: new FileSystemStorageRepository(
//      rootDirectory,        // path to the content folder on disk
//      serializerRegistry,   // { [extension]: StorageSerializer }
//      defaultFileExtension, // extension used when creating new objects
//      ignoreList?           // glob patterns to exclude (optional)
//    )
const storage = new FileSystemStorageRepository(
  './content', // rootDirectory — created automatically on first write
  serializerRegistry,
  'json', // new objects are stored as <key>.json
);

// 3. Wrap storage in document/asset repos (ContentBase layer).
const settings = new DefaultContentBaseSettingsProvider({ storage });
const documents = new ContentBaseDocumentsRepository(storage, settings);
const assets = new ContentBaseAssetsRepository(storage, settings);

// 4. Build the Decap-compatible API.
//    basePath '/api' matches the `api_root` in admin/config.yml below.
//    The handler exposes:
//      GET  /api/health      — status probe (no auth required)
//      *    /api/documents/* — documents JSON:API
//      *    /api/assets/*    — assets JSON:API
//      *    /api/storage/*   — raw storage JSON:API
const api = decapApi({
  documents,
  storage,
  assets,
  basePath: '/api',
  // For local development: accept a single pre-shared bearer token.
  // Replace this with a real session/JWT validator before deploying to production.
  authenticateAccessToken: async token => {
    if (token !== DEV_TOKEN) throw new Error('Invalid token');
    return { id: 'dev', email: 'dev@localhost' };
  },
  // Authorization: decide what an authenticated principal may do. Here, anyone
  // holding a valid token gets full access. Return false (or throw) to deny.
  authorize: () => true,
  // CORS: required when the Decap admin is served from a different origin than this
  // API (e.g. `npx serve admin/ -l 5000` on :5000 while the API runs on :3000).
  // Without this the browser blocks every API call with a CORS error before the
  // Decap admin can authenticate.  In production, list only your actual admin origin.
  cors: { origins: ['http://localhost:5000'] },
});

// 5. Start listening.
serve({ fetch: api.fetch, port: 3000 }, () => {
  console.log('LaikaCMS API listening on http://localhost:3000');
  console.log('Health check: http://localhost:3000/api/health');
});
```

> **Which settings provider?** `DefaultContentBaseSettingsProvider` maps collection names to
> same-name storage folders and auto-creates its settings object on first use — no seeding required.
> It is the right choice for this quickstart and for most simple setups. Switch to
> `DecapContentBaseSettingsProvider` (`laikacms/contentbase-settings-decap`) when you need the
> server and browser Decap configs to stay in sync from one source of truth (it derives
> collection/folder/media mappings from a Decap config JSON you seed into storage), or when you need
> multi-folder or nested collection support.

> **Production auth:** the `authenticateAccessToken` callback above accepts a hard-coded dev token.
> For production, replace it with a real validator (JWT verification, database session lookup, etc.)
> or use the bundled `decapOauth2` helper — see [Decap Integration](./auth).

> **Other base paths:** if you mount behind a reverse proxy at a different prefix, change
> `basePath: '/api'` here and update `api_root` in `admin/config.yml` to match.

---

## 3. Add a start script

In `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "start": "node server.mjs"
  }
}
```

Start the server:

```bash
npm start
```

The API is now available at `http://localhost:3000`. Verify the health endpoint with:

```bash
curl http://localhost:3000/api/health
```

You should receive a JSON response like `{"status":"ok","timestamp":"..."}`. This is the same
endpoint the Decap `laika` backend pings to confirm the server is reachable.

---

## 4. Set up Decap CMS

### 4a. Install the Decap CMS app

`@laikacms/decap` was already installed in §1. Install the Decap CMS browser bundle, the
`@laikacms/decap-cms` peer (provides the `lib/util`, `lib/auth`, `ui/default`, and `core` subpaths
that the Laika backend imports at bundle time), and esbuild (used to compile the TypeScript entry
file into a browser bundle):

```bash
# npm — --legacy-peer-deps is required because decap-cms-app@3 pulls in
# codemirror@5 subpath imports (decap-cms-widget-code), while @laikacms/decap-cms@4
# declares a codemirror@^6 peer; npm@9+ rejects the conflict by default.
# codemirror@5 must also be installed as a direct dependency so npm hoists v5 to
# the top level and nests the @laikacms/decap-cms@4 requirement (codemirror@^6)
# underneath it — without this, npm@11 deduplicates both to codemirror@6 and
# esbuild fails with ~94 "Could not resolve codemirror/keymap/…" errors.
npm install --legacy-peer-deps decap-cms-app @laikacms/decap-cms codemirror@5
npm install --legacy-peer-deps --save-dev esbuild

# pnpm — pnpm v11+ keeps both codemirror versions side-by-side automatically; no override needed.
pnpm add decap-cms-app @laikacms/decap-cms
pnpm add -D esbuild
```

> **pnpm:** these two commands need no flags — the `--allow-build` grants from §1 are already
> recorded in `pnpm-workspace.yaml`. Without those grants `pnpm` exits with
> `ERR_PNPM_IGNORED_BUILDS` and the install step fails.

> The `laika` backend ships as `@laikacms/decap/decap-cms-backend-laika` (a subpath of the
> `@laikacms/decap` package). Import `createLaikaBackend` from there.
>
> `@laikacms/decap-cms` is the scoped Decap CMS fork that provides the
> `@laikacms/decap-cms/lib/util`, `/lib/auth`, `/ui/default`, and `/core` subpaths required by the
> Laika backend. Without it the esbuild step will fail with "Could not resolve
> `@laikacms/decap-cms/…`" errors and produce no `admin/bundle.js`.

> **pnpm peer warnings:** after this install, `pnpm peers check` may report unmet peers for
> `graphql` (`^16` wanted, `15.x` installed by `decap-cms-app@3`) and for `react`/`react-dom`
> (`^16 || ^17 || ^18` from `react-scroll-sync` and similar transitive deps inside `decap-cms-app`).
> These originate inside `decap-cms-app`'s own dependency tree and are harmless — the admin UI
> starts and functions correctly with React 19. You can safely ignore them.

### 4b. Create the HTML entry point

The static file server needs an `index.html` to load your compiled bundle:

```html
<!-- admin/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Admin — LaikaCMS</title>
  </head>
  <body>
    <!-- esbuild compiles admin/index.ts → admin/bundle.js (see §5) -->
    <script src="bundle.js"></script>
  </body>
</html>
```

### 4c. Register the backend

```typescript
// admin/index.ts
import { createLaikaBackend } from '@laikacms/decap/decap-cms-backend-laika';
import CMS from 'decap-cms-app';

// No explicit documentsApiBaseUrl / assetsApiBaseUrl needed: the backend
// derives both from base_url + api_root in config.yml (→ http://localhost:3000/api).
const LaikaBackend = createLaikaBackend();

CMS.registerBackend('laika', LaikaBackend);
CMS.init();
```

### 4d. Write the Decap config

```yaml
# admin/config.yml
backend:
  name: laika
  base_url: http://localhost:3000
  api_root: /api
  # dev_token lets the Decap admin authenticate without an OAuth2 flow.
  # Must match DEV_TOKEN in server.mjs. Remove for production.
  dev_token: dev-secret-change-me

media_folder: uploads
public_folder: /uploads

collections:
  - name: posts
    label: Posts
    folder: posts
    create: true
    format: json # required — the laika Decap backend only supports JSON-format collections today
    fields:
      - { name: title, label: Title, widget: string }
      - { name: body,  label: Body,  widget: richtext }
```

> The v4.beta bundle deprecates `widget: markdown` (DCMS-483) in favour of `widget: richtext`.
> Migration guide:
> [BREAKING_CHANGES_V4_BETA.md](https://github.com/laikacms/decap-cms/blob/v4.beta/BREAKING_CHANGES_V4_BETA.md)
> in `laikacms/decap-cms`.

> **`format: json` is required.** Omitting `format:` makes Decap default to markdown-frontmatter,
> which the laika backend cannot yet persist (see the callout in §1). Saving an entry in such a
> collection now fails with:
> ``Laika backend currently only supports JSON-format collections; set
> `format: json` on collection `<name>`.``

> **`language` field in stored content:** `ContentBaseDocumentsRepository` co-locates the document
> language with its content in storage. When Decap saves an entry that has no i18n configuration, it
> sends `language: "und"` (undetermined per BCP 47). As a result, every stored `.json` file includes
> a `language: "und"` key alongside your declared fields:
>
> ```json
> { "title": "My post", "body": "...", "language": "und" }
> ```
>
> Treat `language` as a LaikaCMS-managed field — do not declare it in Decap's `fields:` list and
> filter it out when reading content files directly for rendering. If you configure i18n, the field
> will contain the active locale instead.

The backend constructs its API URL as `base_url + api_root` → `http://localhost:3000/api`. All
document, asset, storage, and health endpoints are served under that prefix by the `decapApi` server
started in §2.

The `dev_token` value is sent as a Bearer token by the Decap admin; the server's
`authenticateAccessToken` callback checks it. **Never use a dev token in production** — replace it
with a real OAuth2 flow or JWT validator (see [Decap Integration](./auth)).

For a production deployment, replace `http://localhost:3000` with your public API URL and remove the
`dev_token` line.

See [Decap Integration](./) for the full integration guide including OAuth2 setup and available
widgets.

---

## 5. Run locally

In two terminals:

```bash
# Terminal 1 — Decap-compatible API (documents + assets + health at /api/*)
npm start

# Terminal 2 — compile the admin bundle, then serve it
npx esbuild admin/index.ts --bundle --outfile=admin/bundle.js --format=iife --target=es2020
npx serve admin/ -l 5000
```

esbuild bundles `admin/index.ts` together with `decap-cms-app` and
`@laikacms/decap/decap-cms-backend-laika` into a single `admin/bundle.js` that the browser can load
directly. The `-l 5000` flag pins `serve` to port 5000 — without it, `serve` defaults to port 3000
and falls back to a random ephemeral port when the API already holds 3000, breaking the hardcoded
CORS origin. The `serve` step then hosts `admin/index.html` (and `bundle.js`) at
`http://localhost:5000`.

Open `http://localhost:5000` (or wherever `serve` binds) to access the Decap CMS admin UI.

> **Why `cors` is required here:** the admin at `:5000` and the API at `:3000` are different
> origins. Without the `cors` option the browser's CORS preflight (`OPTIONS /api/session`) would be
> answered with a 401 and the Decap admin would show an endless stream of "Authentication failed:
> Failed to fetch" errors — no login form, no collections. The
> `cors: { origins: ['http://localhost:5000'] }` added to `server.mjs` in §2 enables cross-origin
> requests from the admin. In production, replace the origin list with your deployed admin URL (or
> serve the admin and API from the same origin to drop the `cors` option entirely).

> **Rebuild after changes:** re-run the `npx esbuild …` command whenever you edit `admin/index.ts`
> or `admin/config.yml`. For a faster inner loop, append `--watch` to the esbuild command and open a
> third terminal for `npx serve admin/ -l 5000`.

---

## 6. Production deployment

The `decapApi` server is a standard Node.js process and can be deployed anywhere that supports
Node.js 24 or later.

### Key requirement

`FileSystemStorageRepository` reads and writes files at `rootDirectory`. In production you need a
**persistent volume** attached to that path so content survives restarts and redeploys.

### Railway

1. Push your code to a GitHub repository.
2. Create a new Railway project and connect the repo.
3. Add a **Persistent Volume** and mount it at `/app/content` (or wherever you set `rootDirectory`).
4. Set `NODE_ENV=production` and any other environment variables in the Railway dashboard.
5. Railway will run `npm start` automatically.

### Fly.io

```toml
# fly.toml
app = "my-laika-api"
primary_region = "iad"

[build]
dockerfile = "Dockerfile"

[mounts]
source = "content_data"
destination = "/app/content"

[[services]]
internal_port = 3000
protocol = "tcp"

[[services.ports]]
port = 443
handlers = ["tls", "http"]
```

```bash
fly volumes create content_data --size 1
fly deploy
```

### Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Content is stored in /app/content — mount a volume here in production.
VOLUME ["/app/content"]

EXPOSE 3000
CMD ["node", "server.mjs"]
```

```bash
docker build -t laika-api .
docker run -p 3000:3000 -v $(pwd)/content:/app/content laika-api
```

---

## Environment variables

| Variable    | Description                                                                        |
| ----------- | ---------------------------------------------------------------------------------- |
| `PORT`      | Port the server listens on (default: `3000` in the example above).                 |
| `DEV_TOKEN` | Pre-shared bearer token for local dev. Remove entirely for production OAuth2 auth. |

> `decapApi` does not read environment variables directly — pass values from `process.env` when
> constructing the repository, the token string, and the `serve` call.

---

## Next steps

- [Architecture](../../concepts/architecture) — understand the layered design
- [Decap Integration](./) — OAuth2, widgets, media library
- [API Reference](../../reference/json-api/) — full JSON:API endpoint reference
- [Deployment](../deployment) — Cloudflare Workers, AWS Lambda, and more
- [Repositories](../../concepts/repositories) — swap to R2, S3, or other backends
