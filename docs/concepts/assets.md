# Assets

The assets protocol handles binary content — images, PDFs, video — where the interesting parts are
the direct link, the binary metadata, and variants (a resized image for each screen size). It is
[storage](./storage) plus binary behavior, the same way [documents](./documents) is storage plus
editorial behavior.

## Keys, not URLs

Asset content embeds a **key** rather than a deployment-specific URL. A consumer asks the repository
for the asset URL (or a resized variant), and the repository resolves it for the current deployment:
across domains, on localhost, through a CDN, as a signed URL, or with required query parameters.

In a simple setup where URLs are always relative (`/uploads/image1.png`), the key and the URL can be
identical — the repository returns the key immediately, so the abstraction adds no overhead when the
URL can be inferred from the key alone. The payoff comes later: moving your media to a CDN or
switching to signed URLs is a repository change, not a content migration.

## Assets on top of storage

`CatalogAssetsRepository` implements the contract on top of any storage repository:

```typescript
import { CatalogAssetsRepository } from 'laikacms/assets-catalog';

const assets = new CatalogAssetsRepository(storage, settings);
```

Direct implementations exist for sources with native binary handling: `assets-r2` (Cloudflare R2),
`assets-obsidian` (Obsidian vault attachments), and `assets-jsonapi-proxy` (a remote LaikaCMS API).

Uploads can be run through `laikacms/file-sanitizer` before they reach storage.

## Going deeper

- [Assets API reference](../reference/json-api/assets) — the protocol over HTTP
- [Backends](../backends/r2) — asset-capable backends
