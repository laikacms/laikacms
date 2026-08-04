---
"laikacms": minor
---

New `laikacms/storage-github-cdn` export: a read-only `StorageRepository` backed by a **public**
GitHub repository served over CDNs — no credentials and no `@octokit/*` dependency. Ships
`GithubCdnStorageRepository` and its underlying `GithubCdnDataSource` (see the datasource for the
metadata/freshness trade-offs). Writes reject; reads honour a configurable `ignoreList` (`.keep`,
`.DS_Store`, `.contentbase`, … by default) and advertise `changes: unsupportedChanges`.

The package now requires **Node `>=24`** (`engines.node` bumped from `>=22`).
