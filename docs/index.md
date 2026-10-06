# Welcome to <span class="laika-accent">Laika</span>

Laika is a unified abstraction for accessing files, API's and other content. It takes care of all
the complexities like pagination, batching, concurrency, streaming and discovery. Along with that
Laika provides easy to use integrations for common web frameworks and a ton of premade opinionated
adapters.

## Why Laika

### Laika is the transport, you provide the domain

The reason to use Laika is that you don't want to model your domain around your CMS or storage
implementation. The goal of Laika is to get you 90% there. Laika attempts to not hide any details
from you, or to be opinionated about how you model your data and data retrieval. You can read more
about the architecture of Laika [here](./concepts/architecture).

### Built for AI

Laika is also extremely useful as a homogeneous data access layer in the age of LLMs. Laika provides
a built-in MCP server which it feeds with the OpenAPI spec of the JSON:API. Unlike EmDash CMS, it
only has one 'request' tool.

### What Laika offers

<table>
  <tr><th colspan="2">Out of the box</th></tr>
  <tr><td>40+ official adapters</td><td>Real-time updates</td></tr>
  <tr><td>Pagination and filtering</td><td>Batch operations</td></tr>
  <tr><td>Streaming listings</td><td>Change feeds and sync tokens</td></tr>
  <tr><td>Capability discovery</td><td>Any file format</td></tr>
  <tr><td>Drafts and publishing</td><td>Revision history</td></tr>
  <tr><td>Linked assets and image variants</td><td>Conflict detection and locks</td></tr>
  <tr><td>OAuth2, passkeys and 2FA</td><td>Upload sanitization</td></tr>
  <tr><td>Astro, Vite and Decap integrations</td><td>Starters and CLI bootstrapping</td></tr>
</table>

<!--@include: ./.vitepress/adapters/logos.md-->

Laika's core sits on top of [Effect.ts](https://effect.website/). It provides the primitives that
Laika uses, along with some custom primitives like
[`LaikaTask`](./reference/api/laikacms/core/namespaces/LaikaTask/) and
[`LaikaStream`](./reference/api/laikacms/core/namespaces/LaikaStream/).

## Architecture Overview

| Layer          | Packages                                             |
| -------------- | ---------------------------------------------------- |
| API            | storage-api, documents-api, assets-api, catalog-api  |
| Domain         | storage, documents, assets, catalog                  |
| Implementation | storage-r2, storage-fs, documents-drizzle, assets-r2 |
| Shared         | core, auth, crypto, sanitizer, i18n, json-api        |

Each layer depends only on the layers below it.

## Getting Help

- **GitHub Issues** — For bugs and feature requests
- **GitHub Discussions** — For questions and discussions
- **Contributing** — See
  [CONTRIBUTING.md](https://github.com/laikacms/laikacms/blob/develop/CONTRIBUTING.md)

## License

Laika is [MIT licensed](https://github.com/laikacms/laikacms/blob/develop/LICENSE).
