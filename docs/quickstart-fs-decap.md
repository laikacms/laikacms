# Self-Hosting Quickstart: FileSystem + Decap CMS

This guide walks you through running LaikaCMS on a plain Node.js server using
`@laikacms/storage-fs` (local filesystem storage) and
`@laikacms/decap-cms-backend-laika` as the Decap CMS backend. It is the
simplest possible self-hosted setup — no cloud provider account required.

For a broader overview of the system see [architecture](./architecture.md), and
for Cloudflare Workers or AWS Lambda deployments see [deployment](./deployment.md).

---

## Prerequisites

| Requirement | Version |
| ----------- | ------- |
| Node.js     | 22.x    |
| npm or pnpm | any recent |

---

## 1. Install packages

Install the storage implementation, the HTTP API layer, and a serializer for
the file format you want to store content in:

```bash
# npm
npm install @laikacms/storage-fs @laikacms/storage-api \
  @laikacms/storage-serializers-json @hono/node-server

# pnpm
pnpm add @laikacms/storage-fs @laikacms/storage-api \
  @laikacms/storage-serializers-json @hono/node-server
```

| Package | Purpose |
| ------- | ------- |
| `@laikacms/storage-fs` | `FileSystemStorageRepository` — reads/writes files on disk |
| `@laikacms/storage-api` | `buildJsonApi` — Hono-based JSON:API HTTP server |
| `@laikacms/storage-serializers-json` | Serializes content objects to/from `.json` files |
| `@hono/node-server` | Runs the Hono app on Node.js |

> **Other formats:** swap `@laikacms/storage-serializers-json` for
> `@laikacms/storage-serializers-yaml` if you prefer YAML files, and change
> `'json'` to `'yaml'` in the snippet below.

---

## 2. Create the Node.js server

Create `server.mjs` (or `server.ts` if you have a TypeScript build step):

```js
// server.mjs
import { serve } from '@hono/node-server';
import { buildJsonApi } from '@laikacms/storage-api';
import { FileSystemStorageRepository } from '@laikacms/storage-fs';
import { jsonSerializer } from '@laikacms/storage-serializers-json';

// 1. Build a serializer registry — maps file extensions to serializers.
const serializerRegistry = {
  json: jsonSerializer,
};

// 2. Instantiate the repository.
//    Constructor: new FileSystemStorageRepository(
//      rootDirectory,        // path to the content folder on disk
//      serializerRegistry,   // { [extension]: StorageSerializer }
//      defaultFileExtension, // extension used when creating new objects
//      ignoreList?           // glob patterns to exclude (optional)
//    )
const repo = new FileSystemStorageRepository(
  './content',          // rootDirectory — created automatically on first write
  serializerRegistry,
  'json',               // new objects are stored as <key>.json
);

// 3. Wrap the repository in a JSON:API HTTP server.
const api = buildJsonApi({ repo });

// 4. Start listening.
serve({ fetch: api.fetch, port: 3000 }, () => {
  console.log('LaikaCMS storage API listening on http://localhost:3000');
});
```

> **basePath:** if you mount the storage API under a sub-path (e.g. behind a
> reverse proxy at `/api/storage`), pass `basePath: '/api/storage'` to
> `buildJsonApi` so that URL routing is handled correctly.

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

The API is now available at `http://localhost:3000`. Verify with:

```bash
curl http://localhost:3000
```

You should receive a JSON:API response describing the available endpoints.

---

## 4. Set up Decap CMS

### 4a. Install the backend

```bash
# npm
npm install @laikacms/decap-cms-backend-laika decap-cms-app

# pnpm
pnpm add @laikacms/decap-cms-backend-laika decap-cms-app
```

### 4b. Register the backend

```typescript
// admin/index.ts (or admin/index.js)
import createLaikaBackend from '@laikacms/decap-cms-backend-laika';
import CMS from 'decap-cms-app';

const LaikaBackend = createLaikaBackend({
  documentsApiBaseUrl: 'http://localhost:3000',
  assetsApiBaseUrl: 'http://localhost:3000',
});

CMS.registerBackend('laika', LaikaBackend);
CMS.init();
```

### 4c. Write the Decap config

```yaml
# admin/config.yml
backend:
  name: laika
  base_url: http://localhost:3000
  api_root: /api

media_folder: uploads
public_folder: /uploads

collections:
  - name: posts
    label: Posts
    folder: posts
    create: true
    fields:
      - { name: title, label: Title, widget: string }
      - { name: body,  label: Body,  widget: markdown }
```

The `base_url` and `api_root` together tell the backend where the LaikaCMS
storage API is running. For a production deployment replace
`http://localhost:3000` with your public API URL.

See [Decap Integration](./decap-integration.md) for the full integration guide
including OAuth2 setup and available widgets.

---

## 5. Run locally

In two terminals:

```bash
# Terminal 1 — storage API
npm start

# Terminal 2 — your frontend (example using a static file server)
npx serve admin/
```

Open `http://localhost:5000` (or wherever `serve` binds) to access the Decap
CMS admin UI.

---

## 6. Production deployment

The storage API is a standard Node.js process and can be deployed anywhere that
supports Node.js 22.

### Key requirement

`FileSystemStorageRepository` reads and writes files at `rootDirectory`.
In production you need a **persistent volume** attached to that path so content
survives restarts and redeploys.

### Railway

1. Push your code to a GitHub repository.
2. Create a new Railway project and connect the repo.
3. Add a **Persistent Volume** and mount it at `/app/content` (or wherever you
   set `rootDirectory`).
4. Set `NODE_ENV=production` and any other environment variables in the Railway
   dashboard.
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

| Variable | Description |
| -------- | ----------- |
| `PORT`   | Port the server listens on (default: `3000` in the example above) |

> `buildJsonApi` does not read environment variables directly — pass values
> from `process.env` when constructing the repository and calling `serve`.

---

## Next steps

- [Architecture](./architecture.md) — understand the layered design
- [Decap Integration](./decap-integration.md) — OAuth2, widgets, media library
- [API Reference](./api-reference.md) — full JSON:API endpoint reference
- [Deployment](./deployment.md) — Cloudflare Workers, AWS Lambda, and more
- [Repositories](./repositories.md) — swap to R2, S3, or other backends
