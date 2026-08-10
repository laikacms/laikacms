# @laikacms/github

GitHub-backed `StorageRepository` for Laika CMS. Stores content as commits in a GitHub repository;
pairs with the FS adapter for local dev so the same flow works against a real git repo with no FS
required.

## Auth modes

The package ships with **two** authentication shapes. They are mutually exclusive — supply either
App credentials **or** a pre-built `Octokit` instance, not both.

### GitHub App (installation token)

Use when the user editing content is **not** a GitHub user (for example: they signed in to Laika
Cloud with Google, but the content lives in a GitHub repo). The App's installation token lets the
platform write to GitHub on the user's behalf; the user has no GitHub identity to act under.

Practical signs that you need App mode:

- Laika Cloud–style multi-tenant operator where editors don't have to have GitHub accounts.
- A self-hosted gateway that runs its **own** user database (managed via `@laikacms/server/oauth2` +
  `@laikacms/server/api` + `@laikacms/integrations/github`) on top of GitHub storage.

### Pre-configured Octokit (bring-your-own client)

Pass a pre-built `Octokit` instance instead of App credentials. The package uses it as-is for all
API calls — no token minting, no TTL management. This is the right choice when:

- **Testing** — inject a mocked/intercepted Octokit to avoid real GitHub API calls.
- **GitHub Enterprise** — construct `new Octokit({ baseUrl: 'https://github.my-corp.com/api/v3' })`
  and pass it in; no App registration required.
- **Custom plugins / retry strategies** — build an Octokit with `@octokit/plugin-retry` or similar
  and hand it to the storage repository.
- **Any existing Octokit you already have** — if your app already manages a configured Octokit (PAT,
  OAuth token, custom auth), just pass it rather than setting up a GitHub App.

## Usage — App mode

```ts
import { GithubStorageRepository } from '@laikacms/github/storage-gh';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

const storage = new GithubStorageRepository({
  // App-mode auth: supply all three to mint an installation token from the private key.
  appId: env.GITHUB_APP_ID,
  privateKey: env.GITHUB_APP_PRIVATE_KEY,
  installationId: env.GITHUB_APP_INSTALLATION_ID,

  owner: 'esstudio',
  repo: 'content',
  branch: 'main',
  serializerRegistry: {
    yaml: yamlSerializer,
    md: markdownSerializer,
  },
  defaultFileExtension: 'md',
});
```

Then pass `storage` to `laikaApi({ storage, ... })`.

## Usage — Octokit mode

```ts
import { GithubStorageRepository } from '@laikacms/github/storage-gh';
import { Octokit } from '@octokit/rest';

// Any fully-configured Octokit instance works — PAT, OAuth, GHE, custom plugins.
const octokit = new Octokit({ auth: env.GITHUB_TOKEN });

// GitHub Enterprise example:
// const octokit = new Octokit({ baseUrl: 'https://github.my-corp.com/api/v3', auth: env.GHE_TOKEN });

const storage = new GithubStorageRepository({
  octokit, // mutually exclusive with appId / privateKey / installationId

  owner: 'esstudio',
  repo: 'content',
  branch: 'main',
  serializerRegistry: {
    yaml: yamlSerializer,
    md: markdownSerializer,
  },
  defaultFileExtension: 'md',
});
```

---

## Behaviour notes

- **Extension hiding.** Keys are extension-free at the boundary, exactly like `@laikacms/gitlab` and
  `laikacms/storage-fs`. The on-disk file extension is chosen from the registered serializers and
  looked up on read.
- **Empty directories.** Git tracks files, not directories. `createFolder` writes a `.keep` file
  (filtered out of listings via the `ignoreList`).
- **Listings on missing folders.** GitHub's API cannot distinguish an empty directory from a missing
  one — both return HTTP 404. The GitHub backend maps 404 → `Result.succeed([])`, so listing a
  missing folder returns `total: 0` with zero summaries and **no** `recoverableError`. `getFolder`
  on a missing folder similarly succeeds, returning a synthetic `Folder` with `createdAt/updatedAt`
  set to `new Date(0)`. This differs from `@laikacms/gitlab` and `@laikacms/bitbucket`, which
  surface missing-folder 404s as `recoverableError` (`NotFoundError`).
- **Upsert.** `createOrUpdateObject` maps to GitHub's `createOrUpdateFileContents` endpoint. Pass
  `update.metadata.revisionId` (the file's blob `sha`) for optimistic-concurrency updates.
- **Rate limits.** Deep listings (Trees API) and write operations count against your installation's
  primary and secondary rate limits. On 429 or a 403 with `x-ratelimit-remaining: 0`, the backend
  raises `TooManyRequestsError`.

---

## Constructor options

All options are passed as a single object to `new GithubStorageRepository(options)`.

Auth options are a **discriminated union** — supply either `octokit` **or** the three App fields
(`appId`, `privateKey`, `installationId`), never both.

### Required (always)

| Option                 | Type                        | Description                                                                                     |
| ---------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| `owner`                | `string`                    | Repository owner (user or organisation).                                                        |
| `repo`                 | `string`                    | Repository name.                                                                                |
| `branch`               | `string`                    | Branch to read from and write to.                                                               |
| `serializerRegistry`   | `StorageSerializerRegistry` | Map of file extension → serializer. Drives which extensions the integration can read and write. |
| `defaultFileExtension` | `string`                    | Extension used when no other serializer can be determined.                                      |

### Auth — App mode (mutually exclusive with `octokit`)

| Option           | Type               | Description                                                                                              |
| ---------------- | ------------------ | -------------------------------------------------------------------------------------------------------- |
| `appId`          | `string \| number` | GitHub App ID.                                                                                           |
| `privateKey`     | `string`           | PEM private key for the App. Literal `\n` sequences and surrounding quotes are normalised automatically. |
| `installationId` | `string \| number` | Installation ID for the App on the target repo.                                                          |

### Auth — Octokit mode (mutually exclusive with App fields)

| Option    | Type      | Description                                                                                                                                                         |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `octokit` | `Octokit` | Pre-configured `@octokit/rest` instance. The package uses it as-is for all API calls — no token minting or TTL management. Mutually exclusive with App credentials. |

### Optional

| Option               | Type                              | Default                     | Description                                                                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ignoreList`         | `string[]`                        | See below                   | Glob patterns for files that are excluded from directory listings. Overrides the built-in list entirely when supplied.                                                                                                                                                                         |
| `commitAuthor`       | `{ name: string, email: string }` | _(none)_                    | Name and email stamped as **both** the `author` and `committer` fields on every GitHub API write call (`createOrUpdateFileContents` and `deleteFile`). Both fields are set explicitly; neither is left for GitHub to default. Omit to let GitHub fall back to the App installation's identity. |
| `determineExtension` | `DetermineExtension`              | `defaultDetermineExtension` | Custom resolver that picks the file extension for a new object given its key and metadata. Replaces the built-in logic when provided.                                                                                                                                                          |
| `tokenTtlSeconds`    | `number`                          | `3000` (50 min)             | App mode only. How many seconds before the cached installation token is considered stale and a fresh one is minted. GitHub installation tokens last ~1 hour; the default refreshes well before expiry.                                                                                         |
| `userAgent`          | `string`                          | `'@laikacms/github'`        | `User-Agent` header sent on every Octokit request.                                                                                                                                                                                                                                             |

#### Default `ignoreList`

When `ignoreList` is not supplied the following patterns are excluded:

```
**/.keep
**/.DS_Store
**/Thumbs.db
**/desktop.ini
**/.contentbase
**/.laikacms
```

---

## TODO — OAuth user-token auth

**Current state.** The package supports two auth modes: GitHub App (installation token) and
pre-configured Octokit (bring-your-own). The octokit mode unblocks testing, GitHub Enterprise, and
custom auth plugins. A first-class OAuth user-token flow (where the user's GitHub identity appears
on commits) is not yet implemented — it belongs in `@laikacms/server/oauth2` for self-hosted
gateways.

**Target shape.** When implemented, the constructor will accept an **async auth provider** — a
callback invoked on demand to produce credentials. The octokit mode is the interim escape hatch:
pass `new Octokit({ auth: yourToken })` to get non-App auth today.

**Out of scope until the OAuth flow ships:**

- Building the GitHub OAuth flow itself. That belongs in `@laikacms/server/oauth2` (and is
  documented there for self-hosted gateways managing their own users).
- Token storage. Where the token lives between requests (cookie, KV, session, CLI keychain) is a
  consumer concern.
