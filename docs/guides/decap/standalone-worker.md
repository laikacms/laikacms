# Standalone Worker (BYO storage)

This is the primary integration path. Wire the pieces by hand: pick a `StorageRepository`, wrap it
in the ContentBase document/asset repos, and expose them through `laikaApi(...)`. The resulting
`api.fetch` is a Web-standard `(Request) => Promise<Response>` handler you mount on a catch-all
route.

```ts
import { laikaApi } from '@laikacms/server/api';
import { Hono } from 'hono';
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { R2StorageRepository } from 'laikacms/storage-r2';
// …serializers…

const app = new Hono<{ Bindings: Env }>();

app.all('/api/decap/*', async c => {
  const storage = new R2StorageRepository(/* … */);
  const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
  const api = laikaApi({
    documents: new ContentBaseDocumentsRepository(storage, settings),
    storage,
    assets: new ContentBaseAssetsRepository(storage, settings),
    basePath: '/api/decap',
    authenticateAccessToken: yourValidator,
  });
  return api.fetch(c.req.raw);
});
```

Swap `R2StorageRepository` for any other `StorageRepository` implementation to change where content
lives:

| Subpath                    | Class                           | Where                           |
| -------------------------- | ------------------------------- | ------------------------------- |
| `laikacms/storage-fs`      | `FileSystemStorageRepository`   | Node.js local disk              |
| `laikacms/storage-r2`      | `R2StorageRepository`           | Cloudflare R2                   |
| `laikacms/storage-s3`      | S3 shim → `R2StorageRepository` | AWS S3 / MinIO / B2 / DO Spaces |
| `laikacms/storage-drizzle` | `DrizzleStorageRepository`      | Any SQL DB via Drizzle ORM      |
| `laikacms/storage-webdav`  | `WebDavStorageRepository`       | Any RFC 4918 WebDAV server      |

> `FileSystemStorageRepository` requires `node:fs` and a writable local filesystem, so it runs on
> **Node.js** and **Deno 2** (which supports `node:` built-ins) but not on edge runtimes (Cloudflare
> Workers, Deno Deploy, Vercel Edge, …). On the edge, use an edge-compatible storage repo such as
> `R2StorageRepository`.

`api.fetch` is the catch-all handler. To call content directly from server-side render code (and
bypass the authenticated HTTP API), use the `documents` / `assets` / `storage` repos you
constructed.

### Seeding the server-side Decap config

`DecapContentBaseSettingsProvider` reads your Decap config object from storage on **every** content
request — it uses the `collections` array to resolve collection → folder mappings, field schemas,
and media paths. Before any document or asset operation will succeed, seed that config into storage
once (e.g. in a setup script, a one-time migration, or a first-boot handler):

```ts
import { runTask } from 'laikacms/compat';

await runTask(
  storage.createOrUpdateObject({
    key: 'config', // must match the `configKey` option you passed to DecapContentBaseSettingsProvider
    content: {
      collections: [
        {
          name: 'posts', // Decap collection name — also used as the storage folder path
          label: 'Posts',
          folder: 'posts', // folder inside your storage where documents live
          create: true,
          fields: [
            { name: 'title', widget: 'string' },
            { name: 'body', widget: 'markdown' },
          ],
        },
        // …more folder collections…
      ],
      media_folder: 'uploads', // storage folder where uploaded assets are written
      public_folder: '/uploads', // URL prefix embedded in content when Decap references an asset
    },
  }),
);
```

**Serializer requirement.** The config object is structured data. Your storage instance must
register a serializer that round-trips arbitrary objects — `yamlSerializer`, `jsonSerializer`, or
`markdownSerializer` all work. Do **not** use `rawSerializer`: it stores only a plain `body` string
and discards all other fields, so seeding with it silently writes an empty config and every content
request still fails.

**Server config vs. browser config.** There are two separate copies of your Decap config:

| Copy                 | Where                                 | Used by                                                                                        |
| -------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Storage (server)** | Object stored under `configKey`       | `DecapContentBaseSettingsProvider` on every request — maps collection names to storage folders |
| **Browser**          | Passed to `CMS.init({ config: {…} })` | Decap CMS React app — controls which collections appear and how fields render                  |

Both copies must describe the same collections. The recommended pattern is to keep a single
`decapConfig` constant and share it:

```ts
// shared/decap-config.ts — one source of truth for both sides
export const decapConfig = {
  backend: {
    name: 'laika',
    base_url: 'http://localhost:3000', // URL where your LaikaCMS API runs; required for the browser
    api_root: '/api/decap',
  },
  media_folder: 'uploads',
  public_folder: '/uploads',
  collections: [
    {
      name: 'posts',
      label: 'Posts',
      folder: 'posts',
      create: true,
      fields: [{ name: 'title', widget: 'string' }, { name: 'body', widget: 'markdown' }],
    },
  ],
};
```

Seed it server-side once:

```ts
import { runTask } from 'laikacms/compat';
import { decapConfig } from './shared/decap-config.js';

await runTask(storage.createOrUpdateObject({ key: 'config', content: decapConfig }));
```

Pass it to the browser:

```ts
window.CMS.init({ config: decapConfig });
```

> **Skipping this step** is the most common reason a Standalone Worker deployment returns
> `404 "The file at config does not exist"` on every content request. The storage is simply empty —
> seed the config object once and all content operations immediately work.

### WebDAV storage

`WebDavStorageRepository` works with Nextcloud, ownCloud, Apache `mod_dav`, nginx-dav, rclone, and
any other RFC 4918 server. Only a URL (and optionally Basic auth) is needed. Construct it like any
other `StorageRepository` and pass it to `laikaApi(...)`:

```ts
import { laikaApi } from '@laikacms/server/api';
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';
import { WebDavStorageRepository } from 'laikacms/storage-webdav';

const storage = new WebDavStorageRepository(
  {
    baseUrl: process.env.WEBDAV_URL, // https://cloud.example.com/remote.php/dav/files/alice
    auth: { username: 'alice', password: '…' }, // omit for anonymous / token auth
  },
  { md: markdownSerializer, yml: yamlSerializer, json: jsonSerializer, raw: rawSerializer },
  'md', // default extension for new documents
);

const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
const api = laikaApi({
  documents: new ContentBaseDocumentsRepository(storage, settings),
  storage,
  assets: new ContentBaseAssetsRepository(storage, settings),
  basePath: '/api/decap',
  authenticateAccessToken: yourValidator,
});

export const laika = api;
```

The `starter-webdav-blog` example (a complete WebDAV setup including an embedded local-dev WebDAV
server) was moved out of this monorepo in June 2026.
