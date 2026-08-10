# @laikacms/decap/decap-api

[![npm](https://img.shields.io/npm/v/@laikacms/decap)](https://www.npmjs.com/package/@laikacms/decap)
[![npm](https://img.shields.io/npm/dm/@laikacms/decap)](https://www.npmjs.com/package/@laikacms/decap)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@laikacms/decap)](https://bundlephobia.com/result?p=@laikacms/decap)

Decap-compatible HTTP API. A single `fetch(request)` router that composes the `storage`,
`documents`, `assets`, and (optionally) `locks` JSON:API sub-APIs behind one authentication +
authorization boundary, so a Decap CMS admin UI (via `decap-cms-backend-laika`) has one endpoint to
talk to.

## Usage

```typescript
import { decapApi } from '@laikacms/decap/decap-api';

const api = decapApi({
  documents: myDocumentsRepository,
  storage: myStorageRepository,

  authenticateAccessToken: async rawToken => {/* verify bearer token, return User */},
  authorize: ctx => {
    // ctx: { user, request, method, domain, operation, collection?, itemId? }
    if (ctx.operation === 'read') return true;
    return ctx.user.roles?.includes('editor') ?? false;
  },
});

export default { fetch: api.fetch.bind(api) };
```

`decapApi(options)` returns a `DecapApi`:

```typescript
export interface DecapApi {
  fetch(request: Request): Promise<Response>;
  authenticateRequest(request: Request): Promise<Response | User>;
}
```

`fetch` is the full request handler (health check → auth → authorize → dispatch to a sub-API).
`authenticateRequest` is exposed separately for callers that need to authenticate a request without
routing it (e.g. to authenticate a WebSocket upgrade before handing off).

## Required options

| Option                    | Type                                                     | Description                                                                                                                        |
| ------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `documents`               | `DocumentsRepository`                                    | Backs the `/documents` sub-API.                                                                                                    |
| `storage`                 | `StorageRepository`                                      | Backs the `/storage` sub-API.                                                                                                      |
| `authenticateAccessToken` | `(rawToken: string) => Promise<User>`                    | Verifies a Bearer access token and returns the authenticated principal. The primary auth method.                                   |
| `authorize`               | `(ctx: AuthorizeContext) => boolean \| Promise<boolean>` | The only access-control decision point. Runs after authentication, before dispatch to any sub-API. Throwing fails closed (denied). |

`authenticateAccessToken` answers "who is this?"; `authorize` answers "what may they do?" —
authentication never implies authorization. The repositories themselves grant any authenticated
principal full read+write, so a request that reaches them has already passed `authorize`.

`AuthorizeContext` carries the principal plus the request pre-parsed into resource/operation, so a
policy can decide without re-parsing the URL itself:

```typescript
export interface AuthorizeContext {
  user: User;
  request: Request;
  method: string;
  domain: 'documents' | 'storage' | 'assets' | 'session' | 'locks';
  operation: 'read' | 'create' | 'update' | 'delete' | 'publish' | 'unpublish';
  collection?: string;
  itemId?: string;
}
```

## Optional options

| Option                 | Type                                                    | Default   | Description                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `assets`               | `AssetsRepository`                                      | —         | When provided, mounts the `/assets` sub-API. Omitted, `/assets` does not exist.                                                                                                            |
| `locks`                | `LockStore`                                             | —         | When provided, mounts the `/locks` sub-API (advisory entry locking, see below). Omitted, `/locks` does not exist and the Decap admin's "being edited by X" banner degrades to unsupported. |
| `locksTtlMs`           | `number`                                                | 5 minutes | Advisory-lock lifetime, forwarded to the `/locks` sub-API.                                                                                                                                 |
| `basePath`             | `string`                                                | `''`      | Prefix under which every sub-API is mounted, e.g. `/api` puts documents at `/api/documents`.                                                                                               |
| `authenticateApiToken` | `(token: string) => Promise<User>`                      | —         | Authenticates an API key sent via `X-API-Key` or `Authorization: ApiKey <key>`. Required only if callers use API keys.                                                                     |
| `cors`                 | `CorsOptions`                                           | —         | See [CORS](#cors) below. Omitted, no CORS headers are emitted and `OPTIONS` preflights 404.                                                                                                |
| `logger`               | `Pick<Console, 'error' \| 'warn' \| 'info' \| 'debug'>` | —         | Structured logger for internal diagnostics — `console` or any subset-compatible logger.                                                                                                    |

## Scope-based authorization

For the common pattern of granting access based on fine-grained scopes, `@laikacms/decap/decap-api`
ships `createScopePolicy()` — a drop-in `authorize` factory. The scope vocabulary (`hasScope`,
`isScope`, `normalizeScopes`, `GRANULAR_SCOPES`, etc.) is re-exported from `laikacms/auth`.

```typescript
import { createScopePolicy, decapApi } from '@laikacms/decap/decap-api';

const api = decapApi({
  documents,
  storage,
  authenticateAccessToken: async token => {
    const session = await db.sessions.findByAccessToken(token);
    if (!session) throw new Error('Invalid session');
    // Attach scopes to the User so createScopePolicy() can read them.
    return { id: session.userId, email: session.email, scopes: session.scopes };
  },
  // Grants: content:read/write → storage+documents, media:read/write → assets.
  // admin/* satisfies every scope; resource:* satisfies every action on that resource.
  authorize: createScopePolicy(),
});
```

`createScopePolicy(options?)` accepts:

| Option             | Type                                          | Description                                                                            |
| ------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `requiredScopeFor` | `(ctx: AuthorizeContext) => Scope \| null`    | Override the request → required-scope mapping. Return `null` to allow unconditionally. |
| `scopesOf`         | `(ctx: AuthorizeContext) => readonly Scope[]` | How to read the principal's granted scopes. Defaults to `ctx.user.scopes ?? []`.       |

### Role-based authorization

For simpler flat-role policies (not using the `laikacms/auth` scope vocabulary), implement
`authorize` directly:

```typescript
authorize: ctx => {
  if (ctx.operation === 'read') return true;
  return ctx.user.roles?.includes('editor') ?? false;
},
```

## CORS

Required when the Decap admin is served from a different origin than the API (e.g. `npx serve
admin/`
on `:5000` while the API runs on `:3000`):

```typescript
decapApi({
  // …
  cors: { origins: ['http://localhost:5000'] },
});
```

Use `origins: '*'` to allow any origin (convenient for local dev, not for production):

```typescript
cors: {
  origins: '*';
}
```

`maxAge` (seconds, default `86400`) controls the `Access-Control-Max-Age` sent on preflight
responses.

## Routing

`decapApi` resolves every request to one of five domains under `basePath` and dispatches
accordingly. A path matching none of these 404s before authorization runs:

| Path                   | Domain      | Requires                               | Handled by                                                              |
| ---------------------- | ----------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `{basePath}/health`    | —           | nothing (no auth)                      | Inline — `{ status: 'ok', timestamp }`                                  |
| `{basePath}/session`   | `session`   | auth only                              | Inline — returns the authenticated `User`, minus `passwordHash`         |
| `{basePath}/storage`   | `storage`   | auth + authorize                       | `buildJsonApi` from `laikacms/storage/api`, given `options.storage`     |
| `{basePath}/documents` | `documents` | auth + authorize                       | `buildJsonApi` from `laikacms/documents/api`, given `options.documents` |
| `{basePath}/assets`    | `assets`    | auth + authorize, `options.assets` set | `buildAssetsApi` from `laikacms/assets/api`, given `options.assets`     |
| `{basePath}/locks`     | `locks`     | auth + authorize, `options.locks` set  | `buildLocksApi` from `./locks.js`, given `options.locks`                |

Each sub-API is built per-request and mounted at `{basePath}/{domain}` as its own `basePath`, so
each one owns its own JSON:API routing beneath that prefix.

`/health` is the only unauthenticated route. Every other route goes through `authenticateRequest`
(Bearer token via `authenticateAccessToken`, or an API key via `authenticateApiToken` if configured)
and then `authorize(ctx)` before reaching its sub-API.

### Locks sub-API

`/locks` is Decap's advisory entry-locking backend — the server side of the fork's "being edited by
X" banner (see `./locks.ts` for the full state machine: acquire/refresh/release/get with TTL-based
expiry, force-override, and owner-guarded release). It is only mounted when `options.locks` (a
`LockStore`) is provided. The lock owner is always derived from the authenticated principal
(`{ id: user.email, name: user.name ?? user.email }`) — never trusted from the request body — so a
caller cannot release or override another user's lock.

`createInMemoryLockStore()` is exported for local dev/single-instance/tests. For locks to be visible
across nodes, inject a shared store instead (Redis, a KV namespace, a DB table with a TTL column —
anything implementing `LockStore`'s `get`/`set`/`delete`).

## License

MIT
