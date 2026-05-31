# `@laikacms/starter-minio-docker`

**Self-hosted LaikaCMS** with MinIO via docker-compose. One command brings up the CMS + an
S3-compatible bucket persisted to a local volume. Uses the new `laikacms/storage-s3` adapter.

## Run

```bash
# From the workspace root:
docker compose -f apps/starter-minio-docker/docker-compose.yml up --build
```

After ~30 seconds:

- `http://localhost:3000/` — endpoint index (with proof MinIO is wired up).
- `http://localhost:3000/admin` — Decap CMS admin. Create / edit posts.
- `http://localhost:9001/` — MinIO console (login: `minioadmin` / `minioadmin`). Inspect the
  `laikacms` bucket; every Decap save lands here as a real S3 object.

`./data/minio/` holds the persistent volume — back this up to keep your content safe.

## What `docker-compose.yml` orchestrates

| Service      | Purpose                                                  |
| ------------ | -------------------------------------------------------- |
| `minio`      | The S3-compatible object store, port 9000 + console 9001 |
| `minio-init` | Runs `mc mb local/laikacms` once to create the bucket    |
| `laikacms`   | Hono backend, uses `laikacms/storage-s3` over MinIO      |

`minio-init` waits for `minio` to be healthy, then exits cleanly after creating the bucket.
`laikacms` waits for `minio-init` to succeed, then starts.

## The code

`src/server.ts` is the canonical S3-via-laikacms pattern:

```ts
const s3 = new S3Client({/* endpoint, region, credentials */});
const bucket = createS3Bucket({
  client: s3,
  bucketName: 'laikacms',
  commands: {
    HeadObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
  },
});
const storage = new R2StorageRepository(bucket, serializers, 'md');
const laika = createCustomLaika({ storage, decapConfig, basePath, auth });
```

Five imports, five method bindings, one R2-shaped storage, one preset. That's it.

## Switching to a different S3 target

Change three env vars in `docker-compose.yml` (or your `.env`):

| Target        | `S3_ENDPOINT`                                   | Notes                      |
| ------------- | ----------------------------------------------- | -------------------------- |
| MinIO (this)  | `http://minio:9000`                             | `S3_FORCE_PATH_STYLE=true` |
| AWS S3        | leave unset                                     | `S3_REGION=us-east-1` etc  |
| Backblaze B2  | `https://s3.us-west-001.backblazeb2.com`        | `S3_REGION=us-west-001`    |
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` | `S3_REGION=auto`           |
| DigitalOcean  | `https://nyc3.digitaloceanspaces.com`           | `S3_REGION=us-east-1`      |
| Wasabi        | `https://s3.us-east-1.wasabisys.com`            | `S3_REGION=us-east-1`      |

No code changes — the `laikacms/storage-s3` adapter handles all of these.

## Production hardening

- Replace `minioadmin` / `minioadmin` with real credentials in a `.env` file (never commit).
- Run MinIO with TLS — use the `MINIO_SERVER_URL` env var + a real cert.
- Mount `./data/minio` to a persistent disk (Fly volume, EBS, etc.) so content survives host
  replacement.
- Put a reverse proxy (Caddy, nginx, Traefik) in front of `laikacms` for HTTPS + WAF.
- Swap `auth: { mode: 'dev' }` for a real JWT validator.

## Why this matters

The `laikacms/storage-s3` adapter (shipped one iteration ago) means **any** S3-compatible service is
one env-var change away from being your LaikaCMS storage. Pair with docker-compose and you have a
30-second self-host story that works on any cloud + on your laptop.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
