# API

Middleware pages cover what you mount on your server. This one is the content API itself: `laikaApi`
(the production surface, secure by default) and the raw per-protocol builders underneath it.

## `laikaApi` — the recommended surface

`laikaApi` (from `@laikacms/server/api`) exposes documents, assets, storage, and a health probe
under one base path, with **required** authentication and authorization:

```typescript
import { laikaApi } from '@laikacms/server/api';
import { CatalogAssetsRepository } from 'laikacms/assets-catalog';
import { ConventionCatalogProvider } from 'laikacms/catalog-convention';
import { CatalogDocumentsRepository } from 'laikacms/documents-catalog';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { jsonSerializer } from 'laikacms/storage-serializers-json';

const storage = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');
const settings = new ConventionCatalogProvider({ storage });
const documents = new CatalogDocumentsRepository(storage, settings);
const assets = new CatalogAssetsRepository(storage, settings);

const api = laikaApi({
  documents,
  storage,
  assets,
  basePath: '/api', // GET /api/health, /api/documents/*, /api/assets/*, /api/storage/*
  // Required: establishes WHO the caller is. Throw to fail closed on a bad token.
  authenticateAccessToken: async token => {
    const session = await db.sessions.findByAccessToken(token);
    if (!session) throw new Error('Invalid session');
    return db.users.findById(session.userId);
  },
  // Required: decides WHAT they may do. No implicit default — you must state
  // the policy. Return false, or throw, to deny (fails closed).
  authorize: ctx => ctx.operation === 'read',
  // CORS: needed when the admin/frontend runs on a different origin.
  cors: { origins: ['https://admin.example.com'] },
});

export default { fetch: api.fetch };
```

`laikaApi` never falls back to an open policy: omit `authorize` and it's a type error, and a policy
that throws is treated as a denial rather than crashing the request open.

### Public reads, gated writes

Partially-public content is one branch in `authorize`:

```typescript
declare module '@laikacms/server/api' {
  interface User {
    roles: string[];
  }
}

const api = laikaApi({
  documents,
  storage,
  assets,
  authenticateAccessToken: yourValidator, // returns { id, email, roles, … }
  authorize: ctx => {
    if (ctx.operation === 'read') return true; // anyone authenticated may read
    if (ctx.operation === 'delete') return ctx.user.roles.includes('admin'); // admins only
    return ctx.user.roles.includes('editor'); // editors may create/update/publish
  },
});
```

`ctx` also carries `ctx.method` (upper-cased HTTP method) and `ctx.request` (the raw `Request`) for
policies that need to branch on something the parsed fields don't cover — see
[Decap → Authentication](../decap/auth#authorization-with-authorize) for the full `AuthorizeContext`
shape.

### Any runtime

`laikaApi(...)` returns `{ fetch(request: Request): Promise<Response> }` — standard Fetch API, no
framework lock-in. Drop it into Hono (`app.all('/api/*', c => api.fetch(c.req.raw))`), a plain
Node.js server via `@hono/node-server`, a Cloudflare Worker's `fetch` handler, or behind a
Fetch-adapter on AWS Lambda. Frameworks that predate the Web API (Express, plain `http.Server`) need
a small manual bridge — each quickstart shows the bridge its framework needs.

### Embedded shortcut (Node.js)

`createEmbeddedLaika` (`@laikacms/server/embedded`) wires the whole stack above — filesystem
storage, all four serializers, catalog, documents, assets, `laikaApi` — from a single options
object, and seeds the Decap config on first request. Node.js only; on edge runtimes compose
`laikaApi` by hand as above.

## `buildJsonApi` — the raw primitive

::: danger No auth by default `buildJsonApi` performs no authentication — it is the thinnest
possible layer between a repository and the network, and **you secure it yourself**. `authorize` is
still a required option; `allowAll` is the explicit, typed opt-out, not a default. :::

`buildJsonApi` (from `laikacms/storage-api`) wraps any `StorageRepository` in a JSON:API handler.
Reach for it when you're building your own auth/routing layer from scratch, wiring a non-Decap
frontend directly against the Storage JSON:API, or prototyping behind a firewall:

```typescript
import { allowAll } from 'laikacms/json-api';
import { buildJsonApi } from 'laikacms/storage-api';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { rawSerializer } from 'laikacms/storage-serializers-raw';

const repo = new FileSystemStorageRepository('./content', { md: rawSerializer }, 'md');
const api = buildJsonApi({ repo, authorize: allowAll }); // ⚠ allowAll means allow all

export default { fetch: api.fetch };
```

A real `authorize` callback runs once per action — receiving the action name, its direct arguments,
and the whole `Request` — and returns `true` to allow, `false` to deny with a 403, or a `LaikaError`
to deny with a custom status:

```typescript
import { AuthenticationError, ForbiddenError } from 'laikacms/core';

const api = buildJsonApi({
  repo,
  authorize: async ({ action, request }) => {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    const user = token ? await lookupUser(token) : undefined;
    if (!user) return new AuthenticationError('Missing or invalid token'); // → 401
    const reads = ['getObject', 'getFolder', 'getAtom', 'getCapabilities', 'readOpenApi'];
    const isWrite = !reads.includes(action) && !action.startsWith('list');
    if (isWrite && !user.canEdit) return new ForbiddenError('Editors only'); // → 403
    return true;
  },
});
```

The same `authorize` option is required on the documents API (`laikacms/documents-api`), the catalog
API (`laikacms/catalog-api`), and the assets API (`laikacms/assets-api`). Atomic-operation requests
authorize each sub-action up front, so a single denial rejects the whole batch before any write
runs.

Alternatively, gate at the framework level (bearer-auth middleware, a token check in the Worker
`fetch` handler) and keep the handler's own policy `allowAll` — then the middleware is the gate.
[Deploy to Production](../getting-started/deploy) shows both shapes.

## Logging

Pass a `logger` implementing `Pick<Console, 'error' | 'warn' | 'info' | 'debug'>`:

```typescript
const api = buildJsonApi({ repo, authorize, logger: console });

// or filter:
const api2 = buildJsonApi({
  repo,
  authorize,
  logger: { error: console.error, warn: console.warn, info: () => {}, debug: () => {} },
});
```

## Error hygiene

Never include sensitive data in failed results. Use `effect`'s `Secret` for secret values, and keep
sensitive or internal detail inside the `cause` field of `LaikaError` — `cause` stays server-side,
while the error's message and code are what cross the wire (see
[Error responses](../reference/json-api/errors)).

## Related

- [Transports](../concepts/transports) — why the API is `fetch`-shaped
- [JSON:API reference](../reference/json-api/) — every endpoint
- [OAuth2](./oauth2) — a real login server in front of this API
