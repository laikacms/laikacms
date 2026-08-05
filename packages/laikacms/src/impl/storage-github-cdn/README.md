# `laikacms/storage-github-cdn`

A **read-only** `StorageRepository` implementation that serves content straight from a _public_
GitHub repository via CDNs — no GitHub token, no GitHub App, no `@octokit/*` dependency, and no
server round-trip to `api.github.com`.

## Why the CDN path?

Public GitHub content can be read entirely from CDNs instead of the GitHub API:

- **Content** comes from jsDelivr's file CDN (`cdn.jsdelivr.net/gh`).
- **Directory listings** come from jsDelivr's metadata API (`data.jsdelivr.com`), which returns the
  repo's full file tree as JSON in one request (cached and reused for subsequent listing/existence
  checks against the same repository instance).

This makes it a good fit for reading public, mostly-static content (docs sites, demo content,
starter templates) with zero credentials and no server-side proxy. It is **not** a general-purpose
content backend: it cannot write, and CDN responses are cached by jsDelivr for hours, so it is not
suited to live editing.

## Usage

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

### Constructor options (`GithubCdnStorageRepositoryOptions`)

`GithubCdnStorageRepositoryOptions` is `GithubCdnDataSourceOptions` plus the two options every
`StorageRepository` implementation takes:

| Option               | Required | Default                                                                                                                                              | Description                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `owner`              | yes      | —                                                                                                                                                    | GitHub repository owner (user or org).                                                                                                                                                                                                                                                                                                                                                                              |
| `repo`               | yes      | —                                                                                                                                                    | GitHub repository name.                                                                                                                                                                                                                                                                                                                                                                                             |
| `branch`             | no       | the repo's default branch (jsDelivr `HEAD`)                                                                                                          | Branch, tag, or commit sha jsDelivr can resolve.                                                                                                                                                                                                                                                                                                                                                                    |
| `fetchMeta`          | no       | `false`                                                                                                                                              | Controls how `getFileMeta` produces a `revisionId`/`sha`. `false`: no extra request, uses jsDelivr's content hash from the already-loaded tree (empty string if the tree omits it). `true`: downloads the file to compute a canonical git blob sha (one extra fetch per metadata lookup) matching the sha `getObject` returns. Timestamps are always epoch(0) either way — see [Behaviour notes](#behaviour-notes). |
| `cdnBaseUrl`         | no       | `https://cdn.jsdelivr.net/gh`                                                                                                                        | Override the content CDN base.                                                                                                                                                                                                                                                                                                                                                                                      |
| `dataApiBaseUrl`     | no       | `https://data.jsdelivr.com/v1/packages/gh`                                                                                                           | Override the metadata/tree API base.                                                                                                                                                                                                                                                                                                                                                                                |
| `fetch`              | no       | global `fetch`                                                                                                                                       | Injectable fetch implementation, for tests or custom agents.                                                                                                                                                                                                                                                                                                                                                        |
| `userAgent`          | no       | `@laikacms/github-cdn`                                                                                                                               | `User-Agent` header sent on all requests.                                                                                                                                                                                                                                                                                                                                                                           |
| `serializerRegistry` | yes      | —                                                                                                                                                    | Maps file extension → `StorageSerializer`, same as every other `StorageRepository`.                                                                                                                                                                                                                                                                                                                                 |
| `ignoreList`         | no       | same default-exclusions convention as the other storage repositories (`.keep`, `.DS_Store`, `Thumbs.db`, `desktop.ini`, `.contentbase`, `.laikacms`) | Glob patterns excluded from listings.                                                                                                                                                                                                                                                                                                                                                                               |

## The `GithubCdnDataSource` dependency

`GithubCdnStorageRepository` delegates all network I/O to `GithubCdnDataSource`
(`github-cdn-datasource.ts`), which is also exported from this package if you need lower-level
access:

```ts
import { GithubCdnDataSource } from 'laikacms/storage-github-cdn';

const dataSource = new GithubCdnDataSource({ owner: 'my-org', repo: 'my-content-repo' });
```

The data source exposes four operations the repository composes on top of:

- `getFileContents(path)` — fetches raw file content from the content CDN, plus a computed git blob
  sha.
- `getFileMeta(path)` — resolves file existence/type from the cached tree and returns
  `{ sha,
  createdAt, updatedAt }` (see `fetchMeta` above for how `sha` is derived).
- `listDirectory(path)` — lists the immediate children of a directory from the cached tree.
- `pathType(path)` — distinguishes file vs. directory, throwing `NotFoundError` for missing paths.

The full repository file tree is fetched once per `GithubCdnDataSource` instance (on first use) and
cached for the lifetime of that instance; a failed tree fetch clears the cache so a transient error
doesn't stick.

## Read path

- **Extension resolution.** Keys passed to `getObject`/`getAtom` are extension-free. The repository
  probes each extension registered in `serializerRegistry`, trying `getFileMeta` against
  `${key}.${ext}` for each until one resolves — there is no directory listing involved in resolving
  a single object.
- **`getAtom`** first calls `GithubCdnDataSource.pathType`; on `'dir'` it resolves as a folder, on
  `'file'` (or on any failure, including `NotFoundError`) it falls back to probing as a file via
  `getObject`.
- **Listings** (`listAtomSummaries`/`listAtoms`) walk the cached tree via `listDirectory`, filtering
  entries against `ignoreList` and paginating in memory.

## Behaviour notes

- **Read-only.** All mutating operations (`createObject`, `updateObject`, `createOrUpdateObject`,
  `createFolder`, `removeAtoms`) fail with `NotImplementedError`: "This repository is backed by a
  public GitHub CDN and is read-only."
- **No commit history, no real timestamps.** The CDN carries no git history, so `createdAt` and
  `updatedAt` are always epoch(0) (`new Date(0)`) on every object and folder.
- **Pagination.** Cursor pagination is not supported — offset and page styles are emulated in memory
  over the full (filtered) listing.
- **Caching.** jsDelivr caches responses for hours; this repository does not add its own additional
  caching beyond the one in-memory tree fetch per instance, so repeated instantiation re-fetches the
  tree.

## What this does not do

- No writes of any kind — see [Read-only](#behaviour-notes) above.
- No support for private repositories — jsDelivr only serves public GitHub repositories.
- No live-editing freshness guarantees — content can lag behind the actual branch HEAD by however
  long jsDelivr's cache is stale.
