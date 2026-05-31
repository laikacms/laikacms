# `@laikacms/starter-render`

Deploy LaikaCMS to [Render.com](https://render.com). Push to GitHub; Render reads `render.yaml` and
auto-deploys on every commit. Persistent disk for content; free tier covers a hobby blog.

## Deploy

1. **Push this repo to GitHub** (or a fork of it).
2. **Render dashboard** → New → Blueprint → connect the repo.
3. Render reads `apps/starter-render/render.yaml` and offers to create:
   - The web service (Docker, port 10000)
   - A 1 GB persistent disk mounted at `/var/laikacms`
   - The env vars
4. Click "Apply". Render builds the Docker image and deploys in ~3 minutes.

Then:

- `https://laikacms-starter-render.onrender.com/` — endpoint index
- `https://.../admin` — Decap CMS admin
- `https://.../posts` — JSON list

`/var/laikacms/content` is on the persistent disk; content survives deploys.

## Local dev

```bash
pnpm install
pnpm --filter @laikacms/starter-render dev
```

## Free tier caveats

- **Sleeps after 15 minutes idle.** First request after sleep cold-starts in ~30 seconds.
- **In-memory storage on free tier.** The 1 GB persistent disk is a paid feature ($1/mo as of
  writing). On free you lose content on every deploy.

For production, upgrade to the **Starter** plan ($7/mo as of writing) — always warm, persistent disk
included.

## Layout

```
apps/starter-render/
├── render.yaml               # Blueprint: service + disk + env vars
├── Dockerfile                # Workspace-aware Node 22 build
├── content/posts/hello-world.md
├── src/server.ts             # Hono + createEmbeddedLaika rooted at CONTENT_DIR
└── tsconfig.json
```

## Comparison

| Starter                       | PaaS       | Free tier        | Persistent disk |
| ----------------------------- | ---------- | ---------------- | --------------- |
| `starter-render` (this)       | Render.com | yes (sleeps)     | paid only       |
| `starter-fly-io`              | Fly.io     | yes (3 GB free)  | yes on free     |
| `starter-workers-r2`          | Cloudflare | yes (R2 storage) | yes (R2)        |
| `starter-cloudflare-pages`    | Cloudflare | yes              | yes (R2)        |
| `starter-minio-docker`        | self-host  | self-host        | local disk      |
| `starter-lambda-blog` (cloud) | AWS Lambda | AWS Free Tier    | needs S3        |

Most indie devs: **Fly.io** if you want free-tier persistence, **Render** if you want
GitHub-push-deploys without a CLI, **Workers + R2** for edge distribution.

## Production hardening

1. **Auth.** Swap `auth: { mode: 'dev' }` for a real JWT validator.
2. **Disk backups.** Render automatically snapshots disks once a day; for tighter RPO, sync to S3
   via a sidecar cron.
3. **Self-host Decap.** The admin loads CDNs by default — override via
   `decapAdminHtml({ decapBundleUrl, ... })`.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
