# GitHub CDN

`GithubCdnStorageRepository` is a **read-only** `StorageRepository` that serves content straight
from a _public_ GitHub repository via jsDelivr's CDN — no GitHub token, no GitHub App, no
`@octokit/*` dependency, and no round-trip to `api.github.com`. Content comes from
`cdn.jsdelivr.net`; directory listings come from jsDelivr's metadata API, which returns the repo's
full file tree in one cached request.

## Wire it up

```ts
import { runTask } from 'laikacms/compat';
import { GithubCdnStorageRepository } from 'laikacms/storage-github-cdn';
import { jsonSerializer } from 'laikacms/storage-serializers-json';

const repo = new GithubCdnStorageRepository({
  owner: 'my-org',
  repo: 'my-content-repo',
  branch: 'main', // optional — defaults to the repo's default branch
  serializerRegistry: { json: jsonSerializer },
});

const post = await runTask(repo.getObject('posts/hello-world'));
```

This runs anywhere `fetch` runs — including directly in the browser, so a static site can read
public content with **no backend at all**.

## Capability notes

- **Read-only** — every mutating method (`createObject`, `updateObject`, `removeAtoms`, …) rejects.
  Pair with [GitHub](./github) for the write side of the same repository.
- jsDelivr caches responses for hours: treat it as "mostly static public content," not live editing.
- A natural content source for build-time compilation with
  [`@laikacms/vite-plugin`](https://github.com/laikacms/laikacms/blob/develop/packages/vite-plugin/README.md).
