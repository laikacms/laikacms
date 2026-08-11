# Concepts

The mental model behind LaikaCMS. Read this section once and the quickstarts, backends, and API
reference will make sense on their own.

LaikaCMS is, at its core, a **CMS-agnostic protocol**: a small set of repository contracts over
content that knows nothing about any particular editing UI. CMS-specific behaviour lives in
_adapters_ built on top.

- **[Motivation](./motivation)** — what LaikaCMS is, why it exists, and what it deliberately is not.
- **[Architecture](./architecture)** — the layers, the repository pattern, and the composition
  patterns (routing, storage adapter) that everything else reuses.
- **Protocols** — one short page per contract:
  - [Storage](./storage) — atoms, folders, keys, and the `body` convention
  - [Documents](./documents) — status, language, and editorial lifecycle
  - [Assets](./assets) — binary content, keys instead of URLs, variants
  - [Catalog](./catalog) — how collections map onto storage
- **[Transports](./transports)** — the protocols over HTTP: JSON:API built directly on `fetch`.

For terse, load-bearing definitions of every term, see the [Glossary](../reference/glossary).
