# `@laikacms/gitlab`

GitLab-backed `StorageRepository` for Laika CMS. Stores content as commits in a GitLab project via
the REST v4 API; authenticates with a Personal Access Token, an OAuth bearer token, or a CI job
token. The runtime parallel of [`@laikacms/github`](../github), with one major simplification:
GitLab tokens are long-lived, so there is no App-installation flow — bring a token, point at a
project, and write.

Runtime-agnostic: only depends on `fetch`. Works on Node, Bun, Deno, Cloudflare Workers, and the
browser.

## Why a PAT (vs an App)

GitLab Personal Access Tokens scope by project membership and permission set (`read_repository`,
`write_repository`, `api`). Combined with the GitLab "service account" feature (or a regular bot
user), they cover the same threat model as a GitHub App installation token but without the
JWT-mints-installation-token dance — one fewer moving part to break.

For multi-tenant hosting where end users grant you access to their own projects, prefer OAuth 2
bearer tokens (`oauthToken`) over PATs.

## Usage

```ts
import { GitlabStorageRepository } from '@laikacms/gitlab/storage-gl';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const repo = new GitlabStorageRepository({
  projectId: 'esstudio/content', // numeric id OR `group/subgroup/project`
  branch: 'main',
  auth: { token: process.env.GITLAB_PAT! },
  // apiUrl: 'https://gitlab.example.com/api/v4', // self-hosted; defaults to gitlab.com
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
  commitAuthor: { name: 'Laika Bot', email: 'bot@example.com' },
});
```

### OAuth bearer token

```ts
new GitlabStorageRepository({
  projectId: 12345,
  branch: 'main',
  auth: { oauthToken: userOauthToken },
  serializerRegistry,
  defaultFileExtension: 'json',
});
```

### CI job token

Useful when the same repo also hosts a GitLab CI pipeline that writes content back:

```ts
new GitlabStorageRepository({
  projectId: process.env.CI_PROJECT_ID!,
  branch: process.env.CI_COMMIT_REF_NAME!,
  auth: { jobToken: process.env.CI_JOB_TOKEN! },
  serializerRegistry,
  defaultFileExtension: 'md',
});
```

## Behaviour notes

- **Extension hiding.** Keys are extension-free at the boundary, exactly like `@laikacms/github` and
  `laikacms/storage-fs`. The on-server file extension is chosen from the registered serializers and
  looked up on read.
- **Upsert via POST → PUT.** `createOrUpdate` first tries `POST /repository/files/...` (create); on
  the "already exists" path (HTTP 400 with the matching message) it transparently retries with `PUT`
  (update). The `revisionId` returned in `metadata` is the file's `last_commit_id`, which you can
  pass back via `update.metadata.revisionId` for optimistic-concurrency updates.
- **Empty directories.** Git tracks files, not directories. `createFolder` writes a `.keep` file
  (filtered out of listings via the same ignore list as `storage-fs` and `@laikacms/github`).
- **Listings on missing folders** are reported as `recoverableErrors` (a `NotFoundError`), matching
  every other `StorageRepository`.
- **Pagination.** Cursor pagination is not supported. The directory listing pages through
  `X-Next-Page` until exhausted, then offset/page styles are applied in memory.
- **Self-hosted.** Pass `apiUrl: 'https://gitlab.example.com/api/v4'` for a self-hosted instance.

## What this does not do

- No GitLab Merge Request integration. Each write is a direct commit on the configured `branch`. If
  you want a "draft → MR → review" workflow, do it at a layer above (e.g. wire `branch` to a
  per-editor branch and open the MR yourself).
- No webhooks. If you need to react to changes pushed from elsewhere, subscribe to GitLab webhooks
  separately and invalidate your caches.
- No LFS. Objects are stored as plain files; binary assets belong behind the assets API, not the
  storage API.
