# Laika CMS

<p align="center">
  <strong>Modular, runtime-agnostic content management software</strong>
</p>

<p align="center">
  <a href="https://github.com/laikacms/laikacms/blob/develop/LICENSE"><img src="https://img.shields.io/github/license/laikacms/laikacms" alt="License"></a>
  <a href="https://github.com/laikacms/laikacms/pulse"><img src="https://img.shields.io/github/commit-activity/m/laikacms/laikacms/develop" alt="Commit Activity"></a>
  <a href="https://github.com/laikacms/laikacms/commits/develop"><img src="https://img.shields.io/github/last-commit/laikacms/laikacms/develop" alt="Last Commit"></a>
</p>
<p align="center">
  <img src="https://img.shields.io/badge/node-22.x-brightgreen" alt="Node.js">
  <img src="https://img.shields.io/badge/pnpm-10.4.1-orange" alt="pnpm">
  <a href="https://github.com/laikacms/laikacms/network/dependencies"><img src="https://img.shields.io/librariesio/github/laikacms/laikacms" alt="Dependencies"></a>
</p>

---

API-first CMS designed to work with [Decap CMS](https://decapcms.org/) or your own UI. Swap storage
backends without rewriting code.

## Quick Start

```bash
pnpm add laikacms
```

```typescript
import { buildJsonApi } from 'laikacms/storage-api';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { rawSerializer } from 'laikacms/storage-serializers-raw';

const repo = new FileSystemStorageRepository('./content', { md: rawSerializer }, 'md');
const api = buildJsonApi({ repo });

export default { fetch: api.fetch };
```

> **⚠️ No auth by default** — `buildJsonApi` performs no authentication unless you give it one. Pass
> an `authorize` callback (invoked per action with its args + the `Request`, returning
> `true`/`false`/a `LaikaError`), or use `decapApi` for built-in auth. See
> [Getting Started](./docs/guides/getting-started.md) for both.

## Cloudflare Workers

```typescript
import { buildJsonApi } from 'laikacms/storage-api';
import { R2StorageRepository } from 'laikacms/storage-r2';
import { rawSerializer } from 'laikacms/storage-serializers-raw';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new R2StorageRepository(env.CONTENT_BUCKET, { md: rawSerializer }, 'md');
    return buildJsonApi({ repo }).fetch(request);
  },
};
```

## Packages

This repository carries the two core packages. The storage/asset adapters (`@laikacms/aws`,
`@laikacms/github`, …), `laikacli`, `@laikacms/git-gateway`, the `portable-text-*` mappers, and the
example apps were moved out into their own repositories in June 2026 — see
[docs/contributing/restructure-2026-06.md](./docs/contributing/restructure-2026-06.md).

| Package           | Description                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms`        | Core domain, APIs, default implementations, serializers, shared utilities (subpath exports: `laikacms/storage-api`, `laikacms/storage-fs`, `laikacms/storage-r2`, `laikacms/core`, …) |
| `@laikacms/decap` | Decap CMS integrations: backend, OAuth2, widgets, server adapters.                                                                                                                    |

See [docs/reference/packages.md](./docs/reference/packages.md) for the full list of subpath exports,
including the packages that now live in separate repositories.

## Documentation

- **[LLM-GUIDE.md](./LLM-GUIDE.md) — start here if you're an LLM/agent or want the 5-minute
  version**
- [Getting Started](./docs/guides/getting-started.md)
- [Architecture](./docs/concepts/architecture.md)
- [API Reference](./docs/reference/json-api/index.md)
- [Decap Integration](./docs/guides/decap/index.md)
- [Deployment](./docs/guides/deployment.md)
- [Packages](./docs/reference/packages.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Releasing

The two core packages (`laikacms`, `@laikacms/decap`) are released together at the same version
(changesets `fixed` group). Internal `workspace:*` references are pinned to the exact version on
publish. Packages that were moved out of this repo (the adapters, `laikacli`,
`@laikacms/git-gateway`, …) are now released from their own repositories.

```
pnpm changeset
pnpm changeset version
pnpm changeset publish
```

## Claude

The truth is that without a team or a big budget it would have been impossible to materialize my
ideas into an actually useful library. This uniquely allowed me to build such a large project from a
single mental model, which I believe has lead an amazing result. You might think that at first
glance Laika CMS does things in very strange ways, but in fact, everything has been designed,
created, and re-created time and time again, untill the resulting core system was truly headless,
backend agnostic and modular.

Roughly 8 years ago I became very close to releasing my project. Only the maintenance of such a big
monorepo and the scale of the project caught up with me. And trimming the project further would
destroy the main mechanics that made it worthwhile using. The project also carried all the technical
debt of all the previous mistakes and bad assumptions I had made. Claude made it possible to revive
this JAMStack era idea which I think has become, and is becoming more and more relevant now that
writing code has become cheaper and LLM's need homogenous access to information from different
sources.

An honest note is that for right now, if you defacto do not trust AI code\
**don't use Laika CMS** for now. Right now I want to enable highly creative and\
fast growth. In practice this means that stability will come later and\
depends on open source contributions and sponsor and commercial success of the projects that use
Laika CMS right now.

The core parts of Laika CMS were created and coded way back before LLM's were mainstream. The
project started originally all the way back in 2016 when I started to experiment with using the same
schema -> form generator that I had been using for my own client's CMS systems back then. As it grew
more complex I could eventually model the client's content schema with a higher-order schema. At
that point I had a content-model editor or a turing-complete schema-to-form generator if you will.
This is where the rabbit-hole to a perfectly loosely-coupled CMS system came from. I just didnt
realize how difficult it is to make an agnostic, headless content system that can actually be useful
🫠. Through trail and errors I eventually figured out that I needed to think in different layers.
Domain driven design concepts helped a lot with this you'll see a lot of DDD-lite accross this
codebase. The never ending struggle between usefulness and complexity lead to a layered
architecutre. At the Core of Laika CMS sits something called an [`object`](/todo:reference to docs).
Think of it a little bit like an AWS S3 object. It can represent absolutely anything you can think
of that: "Is uniquely addressable". Examples are:

- Choices for a select input ('red', 'green', 'blue' as 3 different objects without a value)
- Records in a database
- Pages on a website
- Metrics from a Sensor

This is the Core of Laika CMS and in theory its a lot more than just a CMS, it's a contract/protocol
that could be used for many other applications than just a CMS, you could use it in any system to
make content from any source addressable through a homegenous surface.

Outside of that core are layers (Union model), which make more and more assumptions the further away
you get. The built-in [`document`](todo:/link to docs) contract assumes that a document has at least
a status and a language. These can be constant if you dont use them. For status you can just return
a constant status: `published` to the contract. The language field will automatically default to
'und' (the valid BCP 47 for 'undertermined').

Layer recap:

- Core: [objects](link here)
- Layer 1: [documents](link here) and [assets] (link here)
- Layer 2: Abstract Repositories/Contracts/Protocol: [repositories](link here)
- Layer 3: Concrete Repository implementations
- Layer 4: Repository Settings
- Layer 5: Settings Providers (can be chained, aka: if your settings live in your content, some
  settings providers can take a repository as an argument and queury it in order to return
  settings).
- Layer 6: Contract consumers, eg: our custom Decap CMS fork

We won't dive into the Decap CMS fork because it has been built-up from the ground up. There's
almost no original code in it anymore. It's rebuild to have the same layered approach to Laika CMS
with an agnostic core and opionated outer layers. I kept the Decap CMS core and extracted the
opionated parts into a seperate package. This is because I dont want to make a fork that only works
with my own project. My fork is still usable copmletely standalone without any Laika CMS stuff. This
is a well deserved thank-you gesture to the Decap CMS maintainers for creating a CMS that is already
(mostly) backend-agnostic _and_ headless. Check out [laikacms/decap-cms](link:/to repo) to learn
more.

Each layer makes more and more assumptions about your domain model. We provide implementations for
common data sources so you can pick and compose what you need like a banquet. They reason you are
using Laika CMS is probably because you did not want to model your domain around your CMS, so the
goal of Laika CMS is to get you 90% there but you will most likely implement (or extend) an existing
repository to make it fit in your infrastructure.

After all this explaining, the original point of simplicity might seem a bit counterintuitive now.
But when you start working and looking at your Content CMS this way you'll quickly see how natural
it is and you'll quickly forget all the jargon. This is because almost all CMS's do what we just
did, only they hide the complexity and tightly couple concepts which dont need to be tightly
coupled, for "convenience".

A super example usecase:

- Userspace
  - Domain: eg. Cat, PageAboutCat, CatImage
  - Infra: eg. Markdown and Yaml files on Github (simple example)
    - Cat Yaml files called `cat-hailey.yaml`, `cat-luna.yaml`, etc.
    - Page Markdown files called: `what-hailey-did-today.md`, `crazy-luna.md`
    - Assets like `hailey.png` and `luna.png`

- Laika CMS domain:
  - Storage "Contract" (repository)
  - Document "Contract" (repository)
  - Assets "Contract" (repository)
  - Settings "Contract" (repository)

The contracts make NO assumptions about the shape of your entities. You are not forced to use a
LaikaCMS set of fields at all. The only thing a simple storage contract needs is a "Key" and
"Content"

### Key

Example: `src/blog/hell-world.md` or `94c3f782-cf80-44c7-a9d3-79a49a367dbe`

The key is the unique identifier for an object. I deliberatly did not call this an "ID" since
database ID's are valid keys will keys (filenames for example), are not always valid ID's (maybe
they are but the using calling a filename an ID doesnt seem right). Important is that a `/` inside a
key is seen as a junction. Since I don't want to make assumptions, there is no set of allowed
characters for keys. This is something that I left explicitly undefined since the format of you key
depends on your data model.

### Content

To avoid consumer or integration developer mistakes, Content cannot be _encoded_ as primitive types
like a string or number. Not because we don't want to support simple domain types, but because this
allows you to modify and migrate data in the future. If your content is simply a number, there is no
way to add extra information to this type later. You pass primitive types through the content
contract, wrapped as objects like this:
`{ key: "my-markdown.md", content: { raw: "# My markdown\n\nHello World!" } }` or like this
`{ key: "2028-03-17", content: { temperatureDegrees: 24 } }`. The first example is how a list a
collection of markdown files would be passed through the Laika Storage Protocol. And the second
shows how a temperature measurements collection would be sent.

The contracts only require specific metadata, the 'storage' contract is the simplest of them all
because it makes 0 assumptions about metadata.

- The glue between Laika CMS and userspace
  - Conceptually:
    - Cat maps to the Storage Contract (Raw cat data)
    - PageAboutCat maps to Document Contract (Cat information with page meta like title,
      description, publishedAt, etc)
    - CatImage maps to the Asset Contract (Binary data that I only ever want a direct link to +
      metadata information, like variants for different screen sizes)
  - Technically:
    - Cat fields are parsed and returned as a content object:
      `{ name: "Hailey", age: 11, colors: ['white', 'brown', 'black'] }`
    - A markdown file is parsed and the body and frontmatter fields are extracted into:
      `{ key: "hailey-says-hi.md", body: "# Hailey says hi!\n\nJust a quick photo of Hailey jumping around in the garden: ![img](./uploads/hailey-garden.jpg)",  status: "Published", language: "en" or "en-GB" }`
    - You can request to return the URL for the image (or a resized variation) and a URL is
      returned. This is beacuse we embed the key in our content instead of the URL. This is because
      it must work accross domains, on localhost, for signed URL's, for CDN url's with extra query
      params, etc, etc. If your setup is simple, and your URL's are always relative
      (`/uploads/image1.png`), then the key and url will be the same and the repository will just
      immediately return the key. So this does not create unnessecary overhead for instances where
      the url can be inferred from the key alone.

## License

MIT
