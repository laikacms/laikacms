# Configuration

Decap is configured by one object — collections, fields, media folders, backend coordinates —
whether it arrives as `admin/config.yml`, inline in `CMS.init({ config })`, or seeded into storage
by the server. This page covers the LaikaCMS-specific parts; the general config schema is
[Decap's own reference](https://decapcms.org/docs/configuration-options/).

## The `laika` backend block

```yaml
backend:
  name: laika
  base_url: http://localhost:3000 # origin where your laikaApi handler runs
  api_root: /api                  # must match laikaApi's basePath
  # dev-only, remove for production:
  dev_token: dev-secret-change-me
```

The backend constructs its API URL as `base_url + api_root`; all document, asset, storage, and
health endpoints are served under that prefix. When the server seeds the config
(`createEmbeddedLaika`'s `decapConfig`), `api_url` can be relative and `base_url` omitted.

## `format: json` is required on collections

```yaml
collections:
  - name: posts
    label: Posts
    folder: posts
    create: true
    format: json # ← required today
    fields:
      - { name: title, label: Title, widget: string }
      - { name: body,  label: Body,  widget: richtext }
```

The storage layer itself speaks [every serializer](../serializers/), but the `laika` Decap backend
currently sends structured content to the documents API only for `format: json` collections. Decap's
default when `format:` is omitted is markdown-frontmatter, which this backend does not yet persist —
saving such an entry fails fast with a clear client-side error rather than a broken file write. Set
`format: json` explicitly on every collection.

Also: `widget: markdown` is deprecated in favour of `widget: richtext` (a back-compat alias still
resolves it with a runtime warning).

## The `language` field

`CatalogDocumentsRepository` co-locates the document language with its content, so every stored file
gains a `language` key (`"und"` without i18n configuration, the active locale with it):

```json
{ "title": "My post", "body": "...", "language": "und" }
```

Treat it as a LaikaCMS-managed field — don't declare it in `fields:`, and filter it out when reading
content files directly.

## One config, two consumers

The server and the browser admin must agree on collections. Two ways to keep them agreed:

- **Server-seeded** — pass the config as `createEmbeddedLaika`'s `decapConfig` (or seed it into
  storage under a `configKey` for `DecapCatalogProvider`, `laikacms/catalog-decap`). The server
  serves it to the admin; one source of truth. This is what the starters do, and what you want when
  you need multi-folder or nested collections.
- **Convention** — `ConventionCatalogProvider` (`laikacms/catalog-convention`) needs no config at
  all server-side: collection names map to same-name folders. The admin keeps its own `config.yml`.
  Right for simple setups; see [Concepts → Catalog](../concepts/catalog).

## Typed config with `laika local generate`

[`laika local generate`](../cli/generate) reads `config.yaml` and writes a `config.gen.ts` exposing
it as an `as const` value with inferred literal types — so the server, the admin entry, and your
routes can share one config object with collection names checked by the compiler. Add `--watch`
during development.
