# `@laikacms/starter-netlify-functions`

LaikaCMS deployed as a **Netlify Function** (Node runtime). Hono routes the request inside the
single catch-all function; `laika.fetch` handles the JSON:API and admin.

## Stack

- Netlify Functions v2 (Node runtime; v8 isolates aren't required)
- Hono (routing inside the function)
- `laikacms` — FileSystem storage + ContentBase document model (dev only — see caveat)
- `@laikacms/decap-integrations/embedded` — `createEmbeddedLaika`, `minimalBlogConfig`,
  `decapAdminHtml`

## Run locally

```bash
pnpm install
pnpm --filter @laikacms/starter-netlify-functions dev   # netlify dev
```

`netlify dev` simulates the Netlify runtime locally and proxies your function on port 3000.

## Deploy

```bash
pnpm --filter @laikacms/starter-netlify-functions deploy
```

## Layout

```
apps/starter-netlify-functions/
├── netlify.toml                       # Netlify config + /* → laika redirect
├── netlify/functions/laika.ts         # Hono app, exported as Netlify handler
├── content/posts/hello-world.md
└── tsconfig.json
```

## Storage caveat

Netlify Functions have a writable **ephemeral** `/tmp` filesystem. This starter uses `/tmp` so the
embedded preset works out-of-the-box for dev, but writes don't persist across cold starts. For
production:

1. **Recommended:** wire a small `StorageRepository` over
   [Netlify Blobs](https://docs.netlify.com/blobs/overview/) (`@netlify/blobs`) and pass it to the
   lower-level `decapApi(...)` from `@laikacms/decap-integrations/decap-api` instead of using the
   embedded preset. The shape mirrors `@laikacms/storage-r2` — that's a good copy-paste starting
   point.
2. **Alternative:** use the GitHub-backed `@laikacms/storage-gh` repo so content lives in your repo.

Tracking as a roadmap gap in `docs/starters.md`.

## See also

- `apps/starter-workers-r2/` — Cloudflare Workers + R2 (durable cloud storage that works)
- `apps/starter-vercel-edge/` — same kind of gap on Vercel; documented as a PoC

A first-party `createNetlifyLaika` preset over Netlify Blobs is the right answer to close all three.
See [`docs/starters.md`](../../docs/starters.md).
