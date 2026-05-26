# @laikacms/github

GitHub-backed `StorageRepository` for Laika CMS. Stores content as commits in a GitHub repository;
the package authenticates as a **GitHub App** using installation tokens.

This is the production storage adapter that lets the same `documents-contentbase` flow work against
a real git repo, no FS required. Pair it with the FS adapter (`laikacms/storage-fs`) for local dev
to keep behavior identical across environments.

## Why a GitHub App (not OAuth App or PAT)

- App installation tokens are **scoped to a single repo** (the install). Tokens are short-lived and
  minted on demand from the App's private key — no long-lived secrets in the running Worker.
- The user's GitHub identity (logged in via PKCE) is **independent** of the writer identity. Editors
  don't need write access to the content repo; the App does.
- Audit trail: every commit is attributed to `<App name>[bot]` with the editor's user info in the
  commit message.

## Usage

```ts
import { GithubStorageRepository } from '@laikacms/github/storage-gh';
import { storageSerializerMarkdown } from 'laikacms/storage-serializers-markdown';
import { storageSerializerYaml } from 'laikacms/storage-serializers-yaml';

const storage = new GithubStorageRepository({
  appId: env.GITHUB_APP_ID,
  privateKey: env.GITHUB_APP_PRIVATE_KEY,
  installationId: env.GITHUB_APP_INSTALLATION_ID,
  owner: 'esstudio',
  repo: 'content',
  branch: 'main',
  serializerRegistry: {
    yaml: storageSerializerYaml(),
    md: storageSerializerMarkdown(),
  },
  defaultFileExtension: 'md',
});
```

Then pass `storage` to `decapApi({ storage, ... })`.
