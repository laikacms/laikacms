# GitLab

`GitlabStorageRepository` stores content in a GitLab project via the REST v4 API — gitlab.com or
self-hosted. Runtime-agnostic: it only depends on `fetch`.

## Install

```bash
pnpm add @laikacms/gitlab
```

## Wire it up

```ts
import { GitlabStorageRepository } from '@laikacms/gitlab/storage-gl';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const storage = new GitlabStorageRepository({
  projectId: 'group/subgroup/project', // or the numeric project ID
  branch: 'main',
  auth: { token: process.env.GITLAB_TOKEN! },
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});
```

| Option                 | Required | Description                                                              |
| ---------------------- | -------- | ------------------------------------------------------------------------ |
| `projectId`            | yes      | Numeric ID or URL-encoded path.                                          |
| `branch`               | yes      | Branch to read from and commit to.                                       |
| `auth`                 | no       | Omit for anonymous reads on public projects. Union below.                |
| `apiUrl`               | no       | Defaults to `https://gitlab.com/api/v4`; override for self-hosted.       |
| `serializerRegistry`   | yes      | Extension → [serializer](../serializers/) map.                           |
| `defaultFileExtension` | yes      | Extension used when creating objects.                                    |
| `commitAuthor`         | no       | `{ name, email }` attached to every commit (default: token owner).       |
| `ignoreList`           | no       | Glob patterns hidden from listings (defaults hide `.keep`, `.DS_Store`). |

**Auth union** — supply exactly one of `token` (PAT, sent as `PRIVATE-TOKEN`), `oauthToken`
(Bearer), or `jobToken` (CI `JOB-TOKEN`); `headers` merges extras into every request.

## Capability notes

- **Writes are commits** on the configured branch — audited and revertable.
- Anonymous read-only access works on public projects by omitting `auth`.
- Self-hosted GitLab works via `apiUrl`.
