# Concepts

The mental model behind LaikaCMS. Read this section once and the guides and API reference will make
sense on their own.

LaikaCMS is, at its core, a **CMS-agnostic protocol**: a small set of repository contracts over
content that knows nothing about any particular editing UI. CMS-specific behaviour lives in
_adapters_ built on top. These pages explain how that fits together.

- **[Architecture](./architecture)** — the four layers (API, domain, implementation, shared), the
  principles that keep them decoupled, and the repository / result-stream / Standard Schema
  patterns.
- **[Repositories](./repositories)** — the three repository kinds (documents, assets, storage), the
  routing and storage-adapter patterns, and how proxy repositories reuse connections.
- **[Content Model](./content-model)** — atoms, folders, keys, the `body` convention, and the
  version / sync-token / change-feed primitives for tracking change.

For terse, load-bearing definitions of every term, see the [Glossary](../reference/glossary).
