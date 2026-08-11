---
layout: home

hero:
  name: Laika CMS
  text: The content API you self-host.
  tagline: Git, S3, SQL, or Obsidian as the backend. Decap CMS as the editor. Runs anywhere fetch runs. MIT, forever.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/vite
    - theme: alt
      text: What is Laika?
      link: /concepts/motivation
    - theme: alt
      text: Backends
      link: /backends/github
---

## Content where you already keep it

```ts
import { GithubStorageRepository } from '@laikacms/github/storage-gh';
import { runTask } from 'laikacms/compat';

const repo = new GithubStorageRepository({
  owner: 'acme',
  repo: 'content',
  branch: 'main',
  ...auth,
});

const post = await runTask(repo.getObject('posts/hello-world'));
// swap GitHub for S3, SQL, R2, WebDAV, or your own disk — one constructor, nothing else changes
```

Every backend implements the same small contracts, the [JSON:API](./reference/json-api/) exposes
them over plain `fetch`, and [Decap CMS](./decap/) edits through it. Your content shape stays yours
— the protocol never interprets it.

## Three doors

- **[Quickstarts](./getting-started/vite)** — Vite, Next.js, Node.js, Cloudflare Workers, Vercel.
  Each ends with a working editor and a page serving the content. Or try the
  [in-browser starter](./getting-started/starters) — no install at all.
- **[Concepts](./concepts/motivation)** — what LaikaCMS is, the four protocols, and why everything
  is a repository.
- **[Backends](./backends/github)** — GitHub, GitLab, Bitbucket, S3, R2, DynamoDB, SQL, filesystem,
  the browser, WebDAV, Obsidian, or another LaikaCMS server.

## Getting help

- [GitHub Issues](https://github.com/laikacms/laikacms/issues) — bugs and feature requests
- [GitHub Discussions](https://github.com/laikacms/laikacms/discussions) — questions and ideas
- [Contributing](./contributing/) — LaikaCMS is
  [MIT licensed](https://github.com/laikacms/laikacms/blob/develop/LICENSE), no open-core, no hosted
  tier
