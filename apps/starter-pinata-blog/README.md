# starter-pinata-blog

LaikaCMS blog starter backed by **Pinata (IPFS)** — the first content-addressed backend in the
LaikaCMS suite (`PinataStorageRepository` from `@laikacms/pinata/storage-ipfs`).

## Why IPFS / Pinata

Three traits unique to content-addressed storage:

1. **Copy-on-write updates.** IPFS can't mutate a CID in place — the CID _is_ the content hash.
   `updateObject` pins the new content (→ new CID), then unpins the old CID. In the brief window
   between pin and unpin, `pinList` returns both CIDs; the repository always picks the newest by
   `date_pinned`.

2. **Mutable name-index over immutable CIDs.** The storage key → CID mapping lives in each pin's
   `metadata.name` and `metadata.keyvalues` fields. Reads query Pinata's `pinList` index — not the
   IPFS DAG directly.

3. **Eventual consistency on reads.** `pinList` updates within seconds but not synchronously with
   the pin call. If you read immediately after a write you may see the previous version. For strict
   read-your-writes, add a small client-side cache.

## Quick start

1. Create an API key at
   [app.pinata.cloud/developers/api-keys](https://app.pinata.cloud/developers/api-keys) with
   `pinFileToIPFS`, `unpin`, and `pinList` permissions (or use an Admin key for dev).
2. Copy `.env.example` → `.env` and fill in `PINATA_JWT`.
3. `pnpm dev`

Open `http://localhost:3000/admin` → write a post → visit `http://localhost:3000/posts`.

## Environment variables

| Variable             | Required | Description                                                   |
| -------------------- | -------- | ------------------------------------------------------------- |
| `PINATA_JWT`         | ✅       | API key JWT from the Pinata dashboard                         |
| `PINATA_GATEWAY_URL` | optional | Dedicated gateway URL (default: public gateway, rate-limited) |
| `PORT`               | optional | HTTP port (default: `3000`)                                   |

## Caveats

- **Public IPFS visibility.** Pinned content is retrievable by anyone who knows the CID, even with a
  private gateway. Treat all content as roughly public.
- **No OCC.** Concurrent writers race. Last write wins based on `date_pinned` ordering.
- **Dedicated gateway recommended.** The public gateway at `gateway.pinata.cloud` is rate-limited.
  Provision a dedicated gateway and set `PINATA_GATEWAY_URL` for production.
- **Eventual consistency.** `pinList` index updates are not synchronous. Don't rely on
  read-your-writes without a cache layer.
