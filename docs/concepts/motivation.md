# Motivation

LaikaCMS is an MIT-licensed content API you self-host. Your content lives in a backend you already
trust — a Git repository, S3, a SQL database, even an Obsidian vault — and LaikaCMS gives it
addresses, contracts, and an HTTP API. [Decap CMS](https://decapcms.org/) is the editing UI on top;
your site or app reads the same content through the same contracts.

## Why it exists

Most CMSs make you model your domain around _their_ data model: their field types, their record
shapes, their storage. Migrating in means rewriting your content; migrating out means rewriting it
again. LaikaCMS inverts that: the protocol knows only keys, atoms, and metadata — the `content`
object is yours and is never interpreted. A cat can stay `{ name: 'Hailey', age: 11 }`; LaikaCMS
only wraps it with the addressing and transport behavior needed to move it around.

Because the contracts are small, swapping infrastructure is a constructor change, not a rewrite:

```ts
// Yesterday: content on disk
const storage = new FileSystemStorageRepository('./content', serializers, 'json');

// Today: content in a GitHub repo — nothing above this line changes
const storage = new GithubStorageRepository({ owner, repo, branch, ...auth });
```

Everything above the storage layer — document and asset repositories, the JSON:API, the Decap admin,
the Vite plugin — works unchanged against either.

## What it is

- **A set of protocols** — [Storage](./storage), [Documents](./documents), [Assets](./assets), and
  [Catalog](./catalog) — each a small contract with many interchangeable implementations.
- **A content API** — the same contracts [exposed over HTTP as JSON:API](./transports), built
  directly on `fetch`, so it runs on Node.js, Cloudflare Workers, and anywhere else a Web API
  `Request`/`Response` pair works.
- **A Decap CMS backend** — the supported editing UI. Decap integrates with LaikaCMS: it edits
  through the content API, and any LaikaCMS backend becomes a Decap-editable content source.

## What it is not

- **Not a UI.** Decap CMS is the editor; your framework renders the site. LaikaCMS is the layer
  between them.
- **Not a hosted service.** Self-hosting is the default and the point. MIT licensed, no open-core
  tier.
- **Not a data model.** No imposed field types, no required schema. The narrowest contract that fits
  your content is the one you use — and raw storage is always available underneath.

## Where to go next

- [Getting Started](../getting-started/vite) — a working editor + API in minutes
- [Architecture](./architecture) — how the layers fit together
- [Backends](../backends/github) — where your content can live
