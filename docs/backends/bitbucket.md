# Bitbucket

`BitbucketStorageRepository` stores content in a Bitbucket Cloud repository via the REST v2 API.
Runtime-agnostic: it only depends on `fetch`.

## Install

```bash
pnpm add @laikacms/bitbucket
```

## Wire it up

```ts
import { BitbucketStorageRepository } from '@laikacms/bitbucket/storage-bb';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const storage = new BitbucketStorageRepository({
  workspace: 'acme',
  repo: 'content',
  branch: 'main',
  auth: { appPassword: { username: 'bot', password: process.env.BB_APP_PASSWORD! } },
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});
```

| Option                 | Required | Description                                                              |
| ---------------------- | -------- | ------------------------------------------------------------------------ |
| `workspace` / `repo`   | yes      | Workspace and repository slugs.                                          |
| `branch`               | yes      | Branch every commit lands on.                                            |
| `auth`                 | yes      | Union below.                                                             |
| `apiUrl`               | no       | Defaults to `https://api.bitbucket.org/2.0`.                             |
| `serializerRegistry`   | yes      | Extension → [serializer](../serializers/) map.                           |
| `defaultFileExtension` | yes      | Extension used when creating objects.                                    |
| `commitAuthor`         | no       | `{ name, email }` attached to every commit.                              |
| `ignoreList`           | no       | Glob patterns hidden from listings (defaults hide `.keep`, `.DS_Store`). |

**Auth union** — supply one of `appPassword` (`{ username, password }`, sent as HTTP Basic),
`oauthToken` (Bearer), or `tokenProvider` (async, called before every request — useful for token
refresh); `headers` merges extras into every request.

## Capability notes

- **Writes are commits** on the configured branch — audited and revertable.
- `tokenProvider` makes rotating OAuth tokens straightforward in long-lived servers.
