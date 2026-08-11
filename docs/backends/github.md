# GitHub

Backends are where your content lives. Every backend implements the same
[Storage protocol](../concepts/storage) (or a higher one), so switching backends is a constructor
change — everything above the repository keeps working.

`GithubStorageRepository` stores content directly in a GitHub repository via the GitHub API,
authenticated as a **GitHub App**. Every write is a commit; your content history is your git
history.

## Install

```bash
pnpm add @laikacms/github
```

## Wire it up

```ts
import { GithubStorageRepository } from '@laikacms/github/storage-gh';

const storage = new GithubStorageRepository({
  appId: process.env.GITHUB_APP_ID!,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY!, // PEM; literal \n sequences are normalised
  installationId: process.env.GITHUB_APP_INSTALLATION_ID!,
  owner: 'acme',
  repo: 'content',
  branch: 'main',
});
```

Auth is a discriminated union — instead of App credentials you can pass a pre-configured `octokit`
instance (for PAT or custom auth):

| Option            | Required when           | Description                                             |
| ----------------- | ----------------------- | ------------------------------------------------------- |
| `octokit`         | using PAT / custom auth | Pre-built Octokit instance; App credentials not needed. |
| `appId`           | App auth                | GitHub App ID.                                          |
| `privateKey`      | App auth                | GitHub App private key (PEM).                           |
| `installationId`  | App auth                | Installation ID for the target repository.              |
| `owner` / `repo`  | always                  | Repository coordinates.                                 |
| `branch`          | always                  | Branch to read from and commit to.                      |
| `tokenTtlSeconds` | —                       | Installation token TTL (default ~50 min).               |
| `userAgent`       | —                       | Custom User-Agent (default `@laikacms/github`).         |

## Capability notes

- **Writes are commits** — slower than object storage, but fully audited and revertable.
- Reads go through the GitHub API and count against its rate limits. For public repos that only need
  reads, [GitHub CDN](./github-cdn) avoids tokens and rate limits entirely.
- For a starter using this backend end-to-end, see
  [`starter-github-blog`](../getting-started/starters).
