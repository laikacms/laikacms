# Catalog

The catalog protocol answers one question the other protocols deliberately don't: **how is this
content organized?** Which collections exist, which storage folder each one lives in, where media
goes, and what schema (if any) a collection follows. It is the configuration layer that lets the
generic document/asset adapters work against plain storage.

## Providers

A **catalog provider** supplies those settings. Providers can be chained, and because settings can
themselves live in content, a provider can query a storage repository to find them.

Two providers cover most setups:

- **`ConventionCatalogProvider`** (`laikacms/catalog-convention`) — maps collection names to
  same-name storage folders by convention and auto-creates its settings on first use. No seeding
  required; the right choice for simple setups. Persists its state under `.laika/` in storage.
- **`DecapCatalogProvider`** (`laikacms/catalog-decap`) — derives collection/folder/media mappings
  from a Decap CMS config seeded into storage, so the server and the Decap admin share one source of
  truth. Use it when you need multi-folder or nested collections, or when the admin config _is_ the
  config.

```typescript
import { ConventionCatalogProvider } from 'laikacms/catalog-convention';

const settings = new ConventionCatalogProvider({ storage });
// collections named `posts` ⇢ storage folder `posts`, media ⇢ `uploads`, …
```

The documents and assets adapters take a provider at construction time; the API layer exposes the
catalog itself over HTTP so admin UIs can discover collections.

## Going deeper

- [Catalog API reference](../reference/json-api/catalog) — the protocol over HTTP
- [Decap → Configuration](../decap/configuration) — the Decap config as catalog source
