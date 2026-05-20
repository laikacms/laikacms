# `@laikacms/cloudflare`

Cloudflare service implementations for Laika CMS. Each subpath export is independent — there is no umbrella entry — so consumers only pay for what they use.

Runtime-agnostic: every export depends only on `fetch`. No SDK bloat.

## `@laikacms/cloudflare/assets-cf-images`

An `AssetsRepository` backed by [Cloudflare Images](https://developers.cloudflare.com/images/). Sits alongside `storage-d1` in the same package — the **second dual-contract package** in the suite (after `@laikacms/aws`, which has both `storage-s3` and `assets-s3`).

The interesting difference from Cloudinary (`@laikacms/cloudinary/assets-cloudinary`): Cloudflare Images defines variants **at the account level**, not per URL. Cloudinary variations are arbitrary URL transforms (`c_fill,w_400,h_300`) — anything you can express in the transform DSL works. Cloudflare Images variants are **named entries you configure in the dashboard** (`public`, `thumbnail`, `medium`); the repository emits one URL per name. Misnamed variants 404 at the delivery gateway, not at write time.

```ts
import { CloudflareImagesAssetsRepository } from '@laikacms/cloudflare/assets-cf-images';

const repo = new CloudflareImagesAssetsRepository({
  auth: { apiToken: process.env.CLOUDFLARE_API_TOKEN! },        // Images:Edit scope
  accountId:   process.env.CLOUDFLARE_ACCOUNT_ID!,
  accountHash: process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH!,     // different from accountId
  variants: [
    { name: 'public',    mimeType: 'image/jpeg' },
    { name: 'thumbnail', width: 150, height: 150 },
    { name: 'medium',    width: 800 },
  ],
});
```

The account hash is **distinct from the account id** — it's visible in the Cloudflare Images dashboard and shows up in delivery URLs like `https://imagedelivery.net/<hash>/<imageId>/<variant>`.

Other notable quirks:

- **No native folders.** Cloudflare Images is a flat keyspace. The repository encodes Laika folder hierarchy into image ids via `/` (Cloudflare allows `/` in image ids up to 1024 chars) and filters listings client-side after a full `GET /images/v1?page=…` enumeration. Works fine for moderate accounts; document this trade-off for large ones.
- **Custom delivery URL override.** Pass `deliveryUrl: ({accountHash, imageId, variant}) => …` to point at a Worker-fronted custom domain.
- **`updateAsset` is metadata-only.** To rewrite the binary, re-call `createAsset` with the same `key` — Cloudflare Images overwrites on a duplicate id.

## `@laikacms/cloudflare/storage-d1`

A `StorageRepository` backed by [Cloudflare D1](https://developers.cloudflare.com/d1/) via its HTTP REST API. **SQL at the edge over plain HTTP** — runs on Node, Bun, Deno, Workers, the browser. No SQLite driver required.

```ts
import { D1StorageRepository, schemaDdl } from '@laikacms/cloudflare/storage-d1';
import { storageSerializerJson } from 'laikacms/storage-serializers-json';

const repo = new D1StorageRepository({
  auth: {
    apiToken: process.env.CLOUDFLARE_API_TOKEN!,
    // or: tokenProvider: () => refreshedToken(),
  },
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
  databaseId: process.env.D1_DATABASE_ID!,
  // optional — defaults to "laika_storage"; must match /^[A-Za-z_][A-Za-z0-9_]*$/
  tableName: 'site_a_storage',
  serializerRegistry: { json: storageSerializerJson },
  defaultFileExtension: 'json',
});
```

### Provision the schema once

The repository **does not run DDL** — it assumes the table already exists. Provision it via Wrangler or the dashboard once at deploy time:

```bash
wrangler d1 execute my-db --remote --command "$(cat schema.sql)"
```

Where `schema.sql` comes from the exported `schemaDdl()` helper:

```ts
import { schemaDdl } from '@laikacms/cloudflare/storage-d1';

console.log(schemaDdl('laika_storage'));
// =>
//   CREATE TABLE IF NOT EXISTS "laika_storage" (
//     parent_key TEXT NOT NULL,
//     name       TEXT NOT NULL,
//     type       TEXT NOT NULL CHECK (type IN ('file', 'folder')),
//     extension  TEXT,
//     content    TEXT,
//     created_at TEXT NOT NULL,
//     updated_at TEXT NOT NULL,
//     etag       TEXT NOT NULL,
//     PRIMARY KEY (parent_key, name)
//   )
```

### How operations map to SQL

| Operation | SQL |
|---|---|
| `getObject('hello')` | `SELECT * FROM "<t>" WHERE parent_key = '' AND name LIKE 'hello.%'` → filter to registered extensions |
| `getFolder('notes')` | `SELECT * FROM "<t>" WHERE parent_key = '' AND name = 'notes'` |
| `listAtomSummaries('notes')` | `SELECT * FROM "<t>" WHERE parent_key = 'notes'` (one indexed scan; no client-side filter) |
| `createObject` | `INSERT OR REPLACE INTO "<t>" (...) VALUES (?, ...)` |
| `updateObject` | same |
| `removeAtoms` (file) | `DELETE FROM "<t>" WHERE parent_key = ? AND name = ?` |
| `removeAtoms` (folder) | refused if `SELECT 1 FROM "<t>" WHERE parent_key = ? LIMIT 1` finds any row |

### The clever bit — single-`LIKE` extension probe

Most database-backed backends in the suite probe each registered serializer extension with a parallel `EXISTS` (Algolia, DDB) — N round-trips fanned out concurrently. D1's `LIKE` plus a client-side filter does **both lookups in one query**:

```sql
SELECT * FROM "laika_storage" WHERE parent_key = ? AND name LIKE 'hello.%'
```

The repository receives every row whose name starts with `hello.` and returns the first whose extension is registered. One round-trip regardless of the registry size, indexed by the `(parent_key, name)` primary key.

### Trade-offs

- **You provision the table.** No `ensureSchema()` call on first use — saves a round-trip per startup and lets you control migrations explicitly.
- **One table per repository instance.** Pass `tableName` per tenant for multi-tenant deployments. The table name is validated against `^[A-Za-z_][A-Za-z0-9_]*$` so it's safe to interpolate (D1 doesn't allow identifiers as bound parameters).
- **`metadata.revisionId`** is an opaque per-write `etag` (UUID). No native OCC on update — the repository doesn't currently round-trip the etag for `If-Match`-style enforcement.
- **`text` columns only.** Content is stored as a single `TEXT` column — the registered serializer is what produces that string. Use the `json` serializer if your content is structured.
- **D1 row-size limit** of 5 MB per row (Cloudflare's hard limit). Suitable for content; offload large blobs to R2.

### Errors

| HTTP | Laika error |
|---|---|
| 401 | `AuthenticationError` |
| 403 | `ForbiddenError` |
| 404 | `NotFoundError` |
| 429 | `TooManyRequestsError` |
| 5xx | `ServiceUnavailableError` |
| SQL-level `success: false` | `InternalError` (with the upstream message) |
