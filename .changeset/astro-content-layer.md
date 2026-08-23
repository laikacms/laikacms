---
"@laikacms/astro": minor
---

Add `@laikacms/astro`: a first-class Astro integration built on the Content Layer.

- `documentsLoader()` / `objectsLoader()` for `defineCollection({ loader })`, so Astro pages use
  `getCollection`, `getEntry` and `render` instead of the `laika:` import protocol.
- Incremental sync with four tiers — change feed, version tokens, content digest, full reload —
  chosen from what the repository advertises through `getCapabilities()`, degrading cleanly to the
  digest tier on repositories (including the filesystem/Catalog default) that advertise nothing.
- Schema derivation from the catalog: pass `z` and a collection's Zod schema _and_ its entry types
  are generated from your existing CMS config, so fields are declared in one place. Collections
  whose catalog describes no fields get entry types inferred from their content instead. Both go
  through Astro's own `Loader.createSchema()`, landing in `.astro/loaders/`.
- `laika()` integration mounting the dev-only JSON:API and bridging repository change notifications
  to Astro's `refreshContent`, so CMS edits appear without restarting the dev server.
- `api.mode: 'route'` for deployments: an injected on-demand route serving the same JSON:API,
  limited by `access` to published reads (default), all reads, or reads and writes. The policies are
  allowlists and check listing filters, so drafts cannot leak through `filter[type]`.
- `liveDocumentsLoader()` for `defineLiveCollection()`, enabling draft preview at request time.

`starter-astro-blog` and `apps/website` now read content through `astro:content`; the Astro starter
renders post bodies as real HTML via `render(entry)` instead of dumping markdown into a `<pre>`.
