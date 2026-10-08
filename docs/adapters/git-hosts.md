# Git Hosts

Store content as commits on a branch of a GitHub, GitLab, or Bitbucket repository. All three
implement the same
[`StorageRepository`](../reference/api/laikacms/storage/classes/StorageRepository) interface as
every other [adapter](./), so the code that reads and writes content doesn't change. They only
depend on `fetch`, so they run on any runtime.

## GitHub

```bash
pnpm add laikacms @laikacms/github
```

```typescript
import { GithubStorageRepository } from '@laikacms/github/storage-gh';
```

Authenticates as a GitHub App, or with an `Octokit` instance you configure yourself (for example
with a personal access token).

### Options

`GithubStorageRepository` accepts a
[`GithubDataSourceOptions`](../reference/api/github/type-aliases/GithubDataSourceOptions) object.
Auth is a discriminated union — supply either a pre-built `octokit` instance **or** the three GitHub
App credential fields:

| Option                 | Type                                         | Required when           | Description                                                                                        |
| ---------------------- | -------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| `octokit`              | `Octokit`                                    | using PAT / custom auth | Pre-configured Octokit instance. When provided, App credentials (`appId` etc.) are not required.   |
| `appId`                | `string \| number`                           | App auth (no `octokit`) | GitHub App ID.                                                                                     |
| `privateKey`           | `string`                                     | App auth (no `octokit`) | GitHub App private key (PEM). Literal `\n` sequences and surrounding quotes are normalised.        |
| `installationId`       | `string \| number`                           | App auth (no `octokit`) | GitHub App installation ID for the target repository.                                              |
| `owner`                | `string`                                     | always                  | GitHub repository owner (user or org).                                                             |
| `repo`                 | `string`                                     | always                  | GitHub repository name.                                                                            |
| `branch`               | `string`                                     | always                  | Branch to read from and commit to.                                                                 |
| `serializerRegistry`   | `StorageSerializerRegistry`                  | always                  | Map of file extension → serializer (e.g. `{ md: markdownSerializer }`).                            |
| `defaultFileExtension` | `string`                                     | always                  | Extension used when creating objects (e.g. `'md'`).                                                |
| `commitAuthor`         | `{ name: string, email: string }` (optional) | —                       | Author attached to every commit. Omit to let GitHub use the authenticated identity.                |
| `ignoreList`           | `string[]` (optional)                        | —                       | Glob patterns to exclude from directory listings. Defaults hide `.keep`, `.DS_Store`, etc.         |
| `determineExtension`   | `DetermineExtension` (optional)              | —                       | Custom strategy for picking the on-server file extension. Defaults to `defaultDetermineExtension`. |
| `tokenTtlSeconds`      | `number` (optional)                          | —                       | App mode only. Installation token TTL in seconds. Defaults to 50 minutes (tokens last ~1 h).       |
| `userAgent`            | `string` (optional)                          | —                       | Custom User-Agent header for GitHub API requests. Defaults to `@laikacms/github`.                  |

## GitLab

```bash
pnpm add laikacms @laikacms/gitlab
```

```typescript
import { GitlabStorageRepository } from '@laikacms/gitlab/storage-gl';
```

Uses the GitLab REST v4 API, on gitlab.com or a self-hosted instance. Authenticates with a personal
access token, an OAuth bearer token, or a CI job token.

### Options

| Option                 | Type                                                                                                  | Required | Description                                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`            | `string \| number`                                                                                    | always   | Numeric project ID or URL-encoded path (`group/subgroup/project`).                                                                                                          |
| `branch`               | `string`                                                                                              | always   | Branch to read from and commit to.                                                                                                                                          |
| `auth`                 | [`GitlabAuth`](../reference/api/gitlab/interfaces/GitlabAuth)                                         | —        | Auth credentials. Omit for anonymous reads on public projects. See auth union below.                                                                                        |
| `apiUrl`               | `string` (optional)                                                                                   | —        | API base URL. Defaults to `https://gitlab.com/api/v4`. Override for self-hosted GitLab.                                                                                     |
| `serializerRegistry`   | [`StorageSerializerRegistry`](../reference/api/laikacms/storage/interfaces/StorageSerializerRegistry) | always   | Map of extension → serializer (e.g. `{ md: markdownSerializer }`).                                                                                                          |
| `defaultFileExtension` | `string`                                                                                              | always   | Extension used when creating objects (e.g. `'md'`).                                                                                                                         |
| `commitAuthor`         | `{ name: string, email: string }` (optional)                                                          | —        | Author attached to every commit. Omit to use the token owner's identity.                                                                                                    |
| `ignoreList`           | `readonly string[]` (optional)                                                                        | —        | Glob patterns to exclude from directory listings. Defaults hide `.keep`, `.DS_Store`, etc.                                                                                  |
| `determineExtension`   | [`DetermineExtension`](../reference/api/laikacms/storage/type-aliases/DetermineExtension) (optional)  | —        | Custom strategy for picking the on-server file extension. Defaults to [`defaultDetermineExtension`](../reference/api/laikacms/storage/variables/defaultDetermineExtension). |

**`GitlabAuth` union** — supply exactly one of:

| Field        | Type                                | Description                                                |
| ------------ | ----------------------------------- | ---------------------------------------------------------- |
| `token`      | `string`                            | Personal access token. Sent as `PRIVATE-TOKEN` header.     |
| `oauthToken` | `string`                            | OAuth 2.0 bearer token. Sent as `Authorization: Bearer …`. |
| `jobToken`   | `string`                            | CI job token. Sent as `JOB-TOKEN` header.                  |
| `headers`    | `Record<string, string>` (optional) | Extra headers merged into every request.                   |

## Bitbucket

```bash
pnpm add laikacms @laikacms/bitbucket
```

```typescript
import { BitbucketStorageRepository } from '@laikacms/bitbucket/storage-bb';
```

Uses the Bitbucket Cloud REST v2 API. Authenticates with an app password or an OAuth 2.0 token.

### Options

| Option                 | Type                                                                              | Required | Description                                                                                |
| ---------------------- | --------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `workspace`            | `string`                                                                          | always   | Bitbucket workspace slug (e.g. `'acme'`).                                                  |
| `repo`                 | `string`                                                                          | always   | Repository slug within the workspace.                                                      |
| `branch`               | `string`                                                                          | always   | Branch every commit lands on.                                                              |
| `auth`                 | [`BitbucketAuth`](../reference/api/bitbucket/storage-bb/interfaces/BitbucketAuth) | always   | Auth credentials. See auth union below.                                                    |
| `apiUrl`               | `string` (optional)                                                               | —        | API base URL. Defaults to `https://api.bitbucket.org/2.0`.                                 |
| `serializerRegistry`   | `StorageSerializerRegistry`                                                       | always   | Map of extension → serializer (e.g. `{ md: markdownSerializer }`).                         |
| `defaultFileExtension` | `string`                                                                          | always   | Extension used when creating objects (e.g. `'md'`).                                        |
| `commitAuthor`         | `{ name: string, email: string }` (optional)                                      | —        | Author attached to every commit.                                                           |
| `ignoreList`           | `readonly string[]` (optional)                                                    | —        | Glob patterns to exclude from directory listings. Defaults hide `.keep`, `.DS_Store`, etc. |
| `determineExtension`   | `DetermineExtension` (optional)                                                   | —        | Custom strategy for picking the on-server file extension.                                  |

**`BitbucketAuth` union** — supply one of:

| Field           | Type                                     | Description                                                                    |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| `appPassword`   | `{ username: string, password: string }` | App-password tuple. Sent as HTTP Basic.                                        |
| `oauthToken`    | `string`                                 | OAuth 2.0 access token. Sent as Bearer.                                        |
| `tokenProvider` | `() => string \| Promise<string>`        | Async token provider — called before every request (useful for token refresh). |
| `headers`       | `Record<string, string>` (optional)      | Extra headers merged into every request.                                       |
