# Adapters

An **adapter** is a repository implementation for one specific service: it implements
[`StorageRepository`](../reference/api/laikacms/storage/classes/StorageRepository),
[`DocumentsRepository`](../reference/api/laikacms/documents/classes/DocumentsRepository), or
[`AssetsRepository`](../reference/api/laikacms/assets/classes/AssetsRepository) on top of R2, a
filesystem, a git host, a SQL database, and so on. Everything above the repository contract — the
JSON:API servers, the Decap backend, your own code — works the same whichever adapter you plug in.
See [Repositories](../concepts/repositories) for how the contracts fit together.

Most applications only need a **storage adapter**: `laikacms/documents/catalog` and
`laikacms/assets/catalog` project documents and assets onto any storage adapter, and any
[serializer](../reference/imports#serializers) (JSON, YAML, Markdown, raw) works with any storage
adapter.

## All adapters

An adapter can provide a storage, documents and assets repository; the columns link to each one's
documentation.

<!--@include: ../.vitepress/adapters/list.md-->

The list is compiled from
[`adapters.yaml`](https://github.com/laikacms/laikacms/blob/develop/adapters.yaml) in the repository
root, and each adapter page from the README next to its implementation.

## Writing your own

Any class that extends `StorageRepository` (or `DocumentsRepository` / `AssetsRepository`) is an
adapter. Run it against the shared contract tests in `laikacms/storage/testing` (and
`documents/testing`, `assets/testing`) to check it behaves like the built-in ones.
