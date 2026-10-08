# API Server

[Getting Started](./getting-started#serve-it-over-http) serves one storage repository over HTTP with
[`buildJsonApi`](../reference/api/laikacms/storage/api/functions/buildJsonApi). When an app needs
documents, storage, and assets behind **one** endpoint, with authentication built in, use
[`laikaApi`](../reference/api/server/api/functions/laikaApi).

```bash
pnpm add laikacms @laikacms/server
```

```typescript
import { laikaApi } from '@laikacms/server/api';
import { CatalogAssetsRepository } from 'laikacms/assets/catalog';
import { ConventionCatalogProvider } from 'laikacms/catalog-convention';
import { CatalogDocumentsRepository } from 'laikacms/documents/catalog';
import { jsonSerializer } from 'laikacms/serializers/json';
import { FileSystemStorageRepository } from 'laikacms/storage/fs';

const storage = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');
const catalog = new ConventionCatalogProvider({ storage });
const documents = new CatalogDocumentsRepository(storage, catalog);
const assets = new CatalogAssetsRepository(storage, catalog);

const api = laikaApi({
  documents,
  storage,
  assets,
  basePath: '/api',
  // WHO the caller is. Throw to reject the token.
  authenticateAccessToken: async token => {
    const session = await db.sessions.findByAccessToken(token);
    if (!session) throw new Error('Invalid session');
    return db.users.findById(session.userId);
  },
  // WHAT they may do. Return false, or throw, to deny.
  authorize: ctx => ctx.operation === 'read',
});

export default { fetch: api.fetch };
```

Like `buildJsonApi`, `laikaApi` returns a standard `fetch(request): Promise<Response>` handler, so
it runs on Node.js, Bun, Deno, Cloudflare Workers, or anything else that speaks the Fetch API.

## Options

| Option                    | Type                                                                                     | Required | Description                                                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents`               | [`DocumentsRepository`](../reference/api/laikacms/documents/classes/DocumentsRepository) | yes      | Document storage backend                                                                                                                                                                                      |
| `storage`                 | [`StorageRepository`](../reference/api/laikacms/storage/classes/StorageRepository)       | yes      | Raw file storage backend                                                                                                                                                                                      |
| `assets`                  | [`AssetsRepository`](../reference/api/laikacms/assets/classes/AssetsRepository)          | no       | Binary asset storage; enables the `/assets` endpoint when provided                                                                                                                                            |
| `basePath`                | `string`                                                                                 | no       | URL prefix for all endpoints (e.g. `'/api'`)                                                                                                                                                                  |
| `authenticateAccessToken` | `(token: string) => Promise<User>`                                                       | yes      | Validates a Bearer access token and returns the principal's **identity**                                                                                                                                      |
| `authenticateApiToken`    | `(key: string) => Promise<User>`                                                         | no       | Validates an API key sent via `X-API-Key` or `Authorization: ApiKey` for M2M access                                                                                                                           |
| `authorize`               | `(ctx: AuthorizeContext) => boolean \| Promise<boolean>`                                 | yes      | The authorization gate; return `false` to reject with `403`. Fails closed if it throws.                                                                                                                       |
| `logger`                  | `Pick<Console, 'error'\|'warn'\|'info'\|'debug'>`                                        | no       | Receives structured diagnostic output                                                                                                                                                                         |
| `locks`                   | `LockManager`                                                                            | no       | Advisory lock backend for the `/locks` sub-API (Decap "being edited by …" banner). Use `InProcessLockManager` from `laikacms/locks/in-process` for single-node. When omitted, `/locks` returns `204` (no-op). |
| `cors`                    | [`CorsOptions`](../reference/api/server/api/interfaces/CorsOptions)                      | no       | Required when the client is served from a different origin than the API                                                                                                                                       |

## `authorize`: the authorization gate

Authentication answers _who_ the caller is; `authorize(ctx)` answers _what they may do_. There is no
implicit default: you must state the policy, and a policy that throws counts as a denial.

```ts
// Allow everything authenticated:
authorize: () => true,

// Read-only:
authorize: ctx => ctx.operation === 'read',

// Role-based:
authorize: ctx =>
  ctx.operation === 'read' ? true : ctx.user.roles.includes('editor'),
```

`ctx` carries the `user`, the `domain` (`documents`, `storage`, `assets`, `session`, or `locks`),
the `operation` (`read`, `create`, `update`, `delete`, `publish`, `unpublish`), the `collection` and
`itemId` when present, the upper-cased HTTP `method`, and the raw `request`.

See [Authentication](./decap/auth) for API keys, scope-based policies, personal access tokens, and a
complete OAuth2 login server.
