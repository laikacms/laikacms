# `@laikacms/starter-workers-r2`

A **Cloudflare Worker** backend backed by **R2** object storage. Exposes LaikaCMS over JSON:API and
serves a Decap CMS admin shell. This is the production-ready cloud counterpart to
`starter-hono-backend` — no Node.js runtime, no filesystem.

Use this starter when you want:

- A globally distributed CMS backend on Cloudflare's edge.
- Content stored in R2 (essentially S3-compatible), with no servers to manage.
- A reference for the new `@laikacms/decap-integrations/workers` preset.

## Stack

- Cloudflare Workers (V8 isolates) + `nodejs_compat`
- Hono (routing)
- `laikacms/storage-r2` — `R2StorageRepository`
- `@laikacms/decap-integrations/workers` — `createWorkersLaika` (new in this PR)
- Decap CMS shell loaded from a CDN

## Run locally

```bash
pnpm install
pnpm --filter @laikacms/starter-workers-r2 dev
```

Wrangler will spin up a local Worker on `http://localhost:3000` with a **simulated** R2 bucket in
`.wrangler/state/v3/r2/`. No Cloudflare account required for development.

Then:

- `curl http://localhost:3000/` — endpoint index
- `curl http://localhost:3000/posts` — list published posts (empty initially)
- Open `http://localhost:3000/admin` — Decap CMS admin
- Create a post in the admin → it writes to the simulated R2 bucket → it appears in `/posts`.

## Deploy to Cloudflare

```bash
# 1. Create the real R2 buckets (names match wrangler.toml).
wrangler r2 bucket create laikacms-content
wrangler r2 bucket create laikacms-content-preview

# 2. Deploy.
pnpm --filter @laikacms/starter-workers-r2 deploy
```

After deploy you'll get a `https://laikacms-starter-workers-r2.<your-subdomain>.workers.dev` URL.

## Layout

```
apps/starter-workers-r2/
├── wrangler.toml                  # CONTENT R2 binding + nodejs_compat flag
├── src/
│   ├── index.ts                   # Hono app + per-request createWorkersLaika
│   ├── admin.ts                   # Decap CMS shell HTML
│   └── decap-config.ts            # minimalBlogConfig()
└── tsconfig.json
```

## Why per-request `createWorkersLaika`?

Workers isolates are short-lived — bindings like `env.CONTENT` are scoped to the request, so the
LaikaCMS stack must be constructed inside the handler. The cost is just a few object allocations;
the underlying R2 calls are unchanged. The `seedConfigOnFirstRequest: true` flag makes the helper
idempotently seed `config.yml` into R2 on the very first request that arrives in a fresh deployment.

## Production hardening

1. **Auth.** Swap `auth: { mode: 'dev' }` for a real `mode: 'custom'` validator (e.g. JWT from
   Cloudflare Access).
2. **Storage.** R2 is durable by default — but consider lifecycle policies and per-tenant prefixes
   if you're multi-tenant.
3. **Decap shell.** Bundle Decap into the Worker output for production instead of pulling it from
   `unpkg`/`esm.sh` at runtime.
4. **Asset uploads.** The current preset uses `ContentBaseAssetsRepository` over R2 storage
   (metadata-only). Binary uploads land in the same bucket via the storage repo; a dedicated
   `R2AssetsRepository` mode is on the roadmap for image variations / signed URLs.

See [`docs/starters.md`](../../docs/starters.md) and
[`docs/decap-integration.md`](../../docs/decap-integration.md).
