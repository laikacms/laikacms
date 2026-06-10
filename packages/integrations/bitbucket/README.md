# `@laikacms/bitbucket`

A Bitbucket-backed `StorageRepository` for Laika CMS via the
[Cloud REST v2 API](https://developer.atlassian.com/cloud/bitbucket/rest/intro/). Completes the
git-platform triumvirate alongside [`@laikacms/github`](../github) and
[`@laikacms/gitlab`](../gitlab).

Runtime-agnostic — only depends on `fetch`. Works on Node, Bun, Deno, Cloudflare Workers, and the
browser.

## `@laikacms/bitbucket/storage-bb`

```ts
import { BitbucketStorageRepository } from '@laikacms/bitbucket/storage-bb';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const repo = new BitbucketStorageRepository({
  workspace: 'esstudio',
  repo: 'content',
  branch: 'main',
  auth: {
    appPassword: { username: 'alice', password: process.env.BITBUCKET_APP_PW! },
    // or: oauthToken: process.env.BITBUCKET_OAUTH_TOKEN!,
    // or: tokenProvider: () => refreshedAccessToken(),
  },
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
  commitAuthor: { name: 'Laika Bot', email: 'bot@example.com' },
});
```

### The Bitbucket-shaped quirk: one endpoint for every write

GitHub and GitLab each expose separate endpoints for `createOrUpdateFileContents` / `deleteFile`.
Bitbucket folds them into one call: `POST /repositories/{ws}/{repo}/src` with a multipart body. Each
form field whose name is a file path _adds or updates_ that file; each form field literally named
`files` whose value is a path _deletes_ that path. The entire commit lands atomically.

This repository keeps the storage-contract surface one-file-at-a-time for parity with the other git
platforms, but the underlying `dataSource.commit({puts, deletes, commitMessage, author})` is a
single round-trip multi-file commit you can call directly when you want one.

### How operations map

| Operation                                                | Bitbucket call                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `getObject`                                              | `GET /src/{branch}/{path}` for content + `GET /src/{branch}/{path}?format=meta` for metadata            |
| `createObject` / `updateObject` / `createOrUpdateObject` | `POST /src` with the path as a form-field name                                                          |
| `removeAtoms`                                            | `POST /src` with `files=<path>` for each delete                                                         |
| `getFolder`                                              | `GET /src/{branch}/{path}/` (trailing slash) — Bitbucket only returns a listing for trailing-slash URLs |
| `listAtomSummaries`                                      | same; paginates through `next` until exhausted                                                          |
| `createFolder`                                           | writes a `.keep` placeholder (git tracks files, not folders)                                            |

### Auth model

Two modes, both handled behind the scenes:

- **App password** (`auth.appPassword`) — Bitbucket's pre-OAuth credential format. Username +
  app-password tuple sent as HTTP Basic.
- **OAuth 2.0** (`auth.oauthToken` or `auth.tokenProvider`) — modern flow. Token sent as Bearer.

The end-to-end auth-header test verifies that the right scheme reaches the wire (`Basic <b64>` for
app passwords, `Bearer <token>` for OAuth), so misconfiguration surfaces early.

### Behaviour notes

- **Extension hiding.** Keys are extension-free at the boundary; the on-server file name is
  `<key>.<ext>` where `<ext>` is picked from the registered serializers (matches every other
  git-platform repository in the suite).
- **`metadata.revisionId`** is the commit hash that most recently touched the file. No native
  optimistic-concurrency on update — Bitbucket's commit endpoint doesn't accept an `If-Match`
  parallel.
- **Pagination.** `next`-URL drained to completion, then in-memory `offset`/`page` styles applied.
- **Errors.** 401 → `AuthenticationError`, 403 → `ForbiddenError`, 404 → `NotFoundError`, 429 →
  `TooManyRequestsError`, 5xx → `ServiceUnavailableError`.

### What this does not do

- No commit signing.
- No PR / merge-request integration. Writes go directly to the configured branch.
- No webhook subscriptions.
