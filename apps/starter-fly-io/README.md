# `@laikacms/starter-fly-io`

Deploy LaikaCMS to [Fly.io](https://fly.io) with `fly deploy`. Hono + persistent volume for content.
Tigris (Fly's S3-compatible object store) is documented as the multi-region alternative — same code,
different env vars.

## Deploy

```bash
# Install flyctl: https://fly.io/docs/getting-started/installing-flyctl/
fly auth signup    # or `fly auth login`

# From the workspace root (the Dockerfile is workspace-aware):
cd apps/starter-fly-io
fly launch --no-deploy      # creates the app, asks for region. Pick one.
fly volumes create laikacms_content --size 1 --region iad
fly deploy
```

Then:

- `https://<your-app>.fly.dev/` — endpoint index + region + machine ID
- `https://<your-app>.fly.dev/admin` — Decap CMS admin (replace dev auth before going public!)
- `https://<your-app>.fly.dev/posts` — JSON list

`/data/content` lives on the Fly volume; content survives deploys and restarts.

## Local dev

```bash
pnpm install
pnpm build
pnpm --filter @laikacms/starter-fly-io dev
```

Same Hono server, `CONTENT_DIR=./content` by default. The same code that runs on Fly runs locally.

## Two storage paths on Fly

### Default: Fly Volume + FileSystem

What this starter ships with. **Single-region** (volumes don't replicate). Cheapest setup — 2 free
machines + 3GB free volume on Fly's free tier covers a small blog.

```toml
# fly.toml (already configured)
[[mounts]]
source = "laikacms_content"
destination = "/data"
```

### Multi-region: Fly Tigris + `laikacms/storage-s3`

For **global content distribution**, switch to Tigris (Fly's managed S3). The starter code needs ~10
lines changed:

```bash
fly storage create laikacms-content   # creates a Tigris bucket
# Fly auto-injects AWS_* env vars
```

In `src/server.ts`, swap `createEmbeddedLaika` for `createCustomLaika` + `R2StorageRepository` +
`createS3Bucket(...)` (see `apps/starter-minio-docker` for the exact shape — replace the MinIO
endpoint with Tigris). Then remove the `[[mounts]]` block from `fly.toml`. Cost is per GB and per
GET/PUT — usually cheaper than a volume for small content sites.

The choice depends on your blast radius: volume = "this region or down", Tigris = "anywhere Tigris
is up".

## Layout

```
apps/starter-fly-io/
├── fly.toml                  # Fly config (volume mount, health check, scale-to-zero)
├── Dockerfile                # Workspace-aware Node 22 build
├── content/posts/hello-world.md
├── src/server.ts             # Hono + createEmbeddedLaika rooted at CONTENT_DIR
└── tsconfig.json
```

## Production hardening

1. **Auth.** Swap `auth: { mode: 'dev' }` for a real JWT validator.
2. **Backups.** Fly volume snapshots — `fly volumes snapshots create <volume-id>` on a cron, or sync
   to S3 with a sidecar.
3. **Multi-machine.** A volume is single-machine. To run multiple machines for HA, switch to the
   Tigris path described above (or accept that one machine handles writes and others read-only).
4. **Decap shell.** The admin loads from CDNs — for prod, self-host the bundle in `public/` and
   override `decapAdminHtml({ decapBundleUrl, ... })`.

## Comparison with the other deploy starters

| Starter                       | Storage             | Multi-region | Free tier              |
| ----------------------------- | ------------------- | ------------ | ---------------------- |
| `starter-fly-io` (this)       | Fly Volume / Tigris | Tigris only  | Yes (2 machines + 3GB) |
| `starter-workers-r2`          | R2                  | Yes          | Yes (10M reqs/mo)      |
| `starter-cloudflare-pages`    | R2                  | Yes          | Yes (unlimited reqs)   |
| `starter-lambda-blog` (cloud) | S3 (typically)      | Yes          | AWS Free Tier          |
| `starter-minio-docker`        | MinIO (BYO host)    | No (BYO)     | Self-host              |

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
