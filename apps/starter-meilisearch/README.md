# `@laikacms/starter-meilisearch`

**Full-text search** over LaikaCMS posts via [Meilisearch](https://www.meilisearch.com). A small
indexer polls the documents repo and pushes changes to Meilisearch; a `/search?q=...` endpoint
queries the index with highlights.

Real-world integration pattern. Demonstrates how to layer external services on top of LaikaCMS
without modifying the core.

## Stack

- Hono + `@hono/node-server`
- `meilisearch` JS SDK
- `laikacms` + `@laikacms/decap-integrations/embedded`
- The indexer is ~100 LOC, lives in `src/indexer.ts`

## Run

```bash
pnpm install

# Start Meilisearch locally (Docker):
pnpm --filter @laikacms/starter-meilisearch meili:up

# Start the LaikaCMS backend (indexer boots automatically):
pnpm --filter @laikacms/starter-meilisearch dev
```

Then:

- `http://localhost:3000/search?q=hello` — search results in JSON
- `http://localhost:3000/admin` — Decap CMS admin (edit posts → indexer picks up in ~5s)
- `http://localhost:7700/` — Meilisearch dashboard (need to authenticate with `devkey`)

Stop Meilisearch with `pnpm meili:down`.

## How the indexer works

```ts
// indexer.ts
async function snapshot() {/* list published, return Map<key, updatedAt> */}

setInterval(async () => {
  const next = await snapshot();
  const added = [...next].filter(([k]) => !prev.has(k) || prev.get(k) !== next.get(k));
  const removed = [...prev].filter(([k]) => !next.has(k));
  await index.addDocuments(added.map(buildDoc));
  await index.deleteDocuments(removed.map(toId));
  prev = next;
}, POLL_MS);
```

Same change-detection pattern the SSE and WebSocket starters use. **When LaikaCMS gets native
pub/sub** (ADR-001), swap the poll loop for a real subscription — the Meilisearch update calls stay
the same.

## Production hardening

- **Tune the poll interval.** 5s is fine for editorial content; faster for live ticker feeds.
- **Use `MEILI_KEY`** with scoped search-only keys for the public-facing `/search` endpoint, and a
  separate admin key for the indexer. The starter uses one key for simplicity.
- **Backfill on boot.** The indexer does a full sync on startup; for huge content sets, batch the
  initial sync to avoid OOM.
- **Multi-tenant.** Use one index per tenant (`posts_<tenant>`) or a single index with a filterable
  `tenantId` attribute.
- **Embedder hooks.** Meilisearch supports vector search via OpenAI/Cohere embeddings — wire this up
  by adding `embedders` to `index.updateSettings(...)` if you want semantic search.

## Why this matters

LaikaCMS doesn't ship search because search is a wide design space — Algolia / Meilisearch /
Typesense / Elasticsearch all have different tradeoffs. This starter is the **integration
template**: replace `MeiliSearch` with `algoliasearch` / `typesense` / `@elastic/elasticsearch` and
swap the SDK calls; the indexer architecture stays the same.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
