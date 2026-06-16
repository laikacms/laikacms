# `@laikacms/starter-s3-storage`

LaikaCMS over **any S3-compatible object store** — AWS S3, MinIO, Backblaze B2, Cloudflare R2 (via
S3 endpoint), DigitalOcean Spaces. Demonstrates the long-documented "one adapter for every S3-shaped
store" path.

## Status: PoC — head + put only

`server.ts` uses a local `s3-r2-adapter.ts` shim (`createS3BucketShim`) that implements only
`head` and `put` over `@aws-sdk/client-s3`. `get`, `delete`, and `list` are not wired up, so
full content reads/writes/lists do **not** work yet.

`laikacms/storage-s3` exports `createS3Bucket()` (a complete S3→R2Bucket adapter) but the
starter has not been updated to use it. Once it is, the shim can be removed and the starter will
be production-ready.

## Stack

- Hono + `@hono/node-server`
- `@aws-sdk/client-s3` (works against any S3-compatible endpoint)
- `@laikacms/decap-integrations/workers.createWorkersLaika` over the S3 shim
- Decap CMS shell via `decapAdminHtml()`

## Run against MinIO (local dev)

```bash
# 1. Start MinIO locally (or use Docker).
brew install minio/stable/minio
minio server ~/minio-data --console-address :9001
# Or:
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  quay.io/minio/minio server /data --console-address ":9001"

# 2. Make a bucket via the MinIO console (http://localhost:9001) — name it `laikacms`.

# 3. Configure the starter.
cp .env.example .env
# uncomment the MinIO block in .env

# 4. Run.
pnpm install
pnpm build
pnpm --filter @laikacms/starter-s3-storage dev
```

## What the full adapter would look like

A real `laikacms/storage-s3` adapter would mirror the surface of `R2StorageRepository`:

```ts
// Sketch — not implemented yet.
export class S3StorageRepository extends StorageRepository {
  constructor(
    options: {
      client: S3Client;
      bucket: string;
      serializerRegistry: StorageSerializerRegistry;
      defaultFileExtension: string;
      ignoreList?: string[];
    },
  ) { … }

  // Maps each StorageRepository method to one or more S3 commands:
  //   getObject(key)    → GetObjectCommand
  //   updateObject(...) → GetObjectCommand + PutObjectCommand (CAS via IfMatch ETag)
  //   listAtoms(prefix) → ListObjectsV2Command (paginated)
  //   deleteObject(key) → DeleteObjectCommand
  // …etc, ~15 methods total. R2StorageRepository is a fair template.
}
```

Then any S3-compatible service drops in by passing an `S3Client` with the right endpoint.

## Layout

```
apps/starter-s3-storage/
├── src/
│   ├── server.ts                # Hono + createWorkersLaika
│   └── s3-r2-adapter.ts         # @aws-sdk/client-s3 → MinimalR2Bucket (head+put only)
└── tsconfig.json
```

## See also

- [`docs/starters.md`](../../docs/starters.md) — the broader starter index + roadmap note
- [`apps/starter-vercel-edge`](../starter-vercel-edge/) — same PoC pattern but over Vercel Blob
- [`apps/starter-workers-r2`](../starter-workers-r2/) — the real, working R2 path
