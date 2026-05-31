# `@laikacms/starter-vercel-edge`

LaikaCMS on the **Vercel Edge runtime** via Hono. Uses `createWorkersLaika` (the V8-isolate preset)
with a small adapter that wraps `@vercel/blob` to look like a Cloudflare R2 bucket.

> ⚠ **Proof-of-concept.** Vercel Blob and Cloudflare R2 have different APIs. This starter implements
> only the `head` + `put` surface needed by `createWorkersLaika`'s `seedConfigOnFirstRequest` path.
> The underlying `R2StorageRepository` reads/writes/lists/deletes use R2 calls that Vercel Blob does
> NOT expose 1:1 — the JSON:API will work for **dev** reads of the seeded config but will likely
> break on real content operations.
>
> For production on Vercel, two better options:
>
> - **Vercel Node runtime + FileSystem** on a persistent volume.
> - **AWS S3** via `@aws-sdk/client-s3` + a custom `StorageRepository` (the R2 adapter in
>   `laikacms/storage-r2` is a reasonable template).
>
> This starter exists to surface that gap and to keep the queue moving.

## Stack

- Vercel Edge Functions (V8 isolates, web-standard `fetch`)
- Hono (routing)
- `@laikacms/decap-integrations/workers` — `createWorkersLaika` + `MinimalR2Bucket` interface
- `@vercel/blob` wrapped to satisfy the `MinimalR2Bucket` shape
- Decap CMS shell via `decapAdminHtml()`

## Run locally

```bash
pnpm install
pnpm --filter @laikacms/starter-vercel-edge dev   # → vercel dev
```

`vercel dev` simulates the edge runtime locally. You'll need a Vercel account + Blob storage
configured for content writes to actually persist — otherwise the in-memory blob client is used.

## Deploy

```bash
pnpm --filter @laikacms/starter-vercel-edge deploy
```

## Layout

```
apps/starter-vercel-edge/
├── api/
│   ├── index.ts                 # Hono app + per-request createWorkersLaika
│   └── blob-r2-adapter.ts       # @vercel/blob → MinimalR2Bucket shim
├── vercel.json                  # Edge runtime + catch-all rewrites
└── tsconfig.json
```

## What this surfaces for the LaikaCMS roadmap

A first-party `createVercelLaika` preset would let the workspace ship a Vercel Blob-backed
`StorageRepository` (with proper list/get/delete) instead of jamming Vercel Blob through the R2
shape. The same applies to Netlify Blobs, Deno KV, Bun's S3 binding, etc. Tracking as a roadmap note
rather than a separate package right now.

See [`docs/starters.md`](../../docs/starters.md).
