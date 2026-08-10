# laikacms/storage/api

[![npm](https://img.shields.io/npm/v/laikacms)](https://www.npmjs.com/package/laikacms)
[![npm](https://img.shields.io/npm/dm/laikacms)](https://www.npmjs.com/package/laikacms)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/laikacms)](https://bundlephobia.com/result?p=laikacms)

JSON:API server for storage operations.

## ⚠️ Access control

`buildJsonApi` **requires** an `authorize` policy — there is no implicit default, because an API
that silently defaults to open is the failure mode this option exists to prevent. The callback runs
before every action, including the two OpenAPI routes, and receives the action descriptor plus the
originating `Request`:

```typescript
import { AuthenticationError } from 'laikacms/core';

const api = buildJsonApi({
  repo: myStorageRepo,
  authorize: async ({ action, request }) => {
    const user = await myAuth(request);
    if (!user) return new AuthenticationError('Missing token'); // → 401
    return user.isAdmin || action === 'readOpenApi'; // false → 403
  },
});
```

`authorize` decides _what a caller may do_; it does not authenticate them for you. Either validate
the credential inside the callback (as above), or mount the handler behind
[`@laikacms/server/api`](../../../../server/src/api), which authenticates a Bearer token and applies
its own `authorize` gate before forwarding.

For a surface that is _deliberately_ open — a dev server on loopback, a test harness, or a handler
already behind an authenticating proxy — say so explicitly with `allowAll`:

```typescript
import { allowAll } from 'laikacms/json-api';

const api = buildJsonApi({ repo: myStorageRepo, authorize: allowAll });
```

Naming it rather than inlining `() => true` means every intentionally-open surface in a deployment
is one `rg 'authorize: allowAll'` away during an audit.

## Installation

```bash
pnpm add laikacms
```

## Usage

```typescript
import { buildJsonApi } from 'laikacms/storage/api';

const api = buildJsonApi({ repo: myStorageRepo, authorize: myPolicy });
export default { fetch: api.fetch };
```

## Endpoints

| Method | Path                    | Description                   |
| ------ | ----------------------- | ----------------------------- |
| GET    | `/`                     | API info + endpoint discovery |
| GET    | `/capabilities`         | Repository capabilities       |
| GET    | `/openapi.json`         | OpenAPI 3.1 specification     |
| POST   | `/atoms`                | Create a folder               |
| GET    | `/atoms`                | List atoms at root            |
| GET    | `/atoms/{key}`          | List atoms in a folder        |
| GET    | `/atom-summaries`       | List atom summaries at root   |
| GET    | `/atom-summaries/{key}` | List atom summaries in folder |
| GET    | `/objects/{key}`        | Read a storage object         |
| POST   | `/objects`              | Create object                 |
| PATCH  | `/objects/{key}`        | Update object                 |
| DELETE | `/objects/{key}`        | Delete a storage object       |
| GET    | `/folders/{key}`        | Read a folder                 |
| POST   | `/operations`           | Atomic batch operations       |

## Options

```typescript
interface StorageApiOptions {
  repo: StorageRepository;
  basePath?: string;
  onError?(error: unknown): void;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'>;
  authorize: StorageAuthorize;
}
```

| Option      | Type                                              | Default | Description                                                                                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repo`      | `StorageRepository`                               | —       | Required. The storage repository implementation to back the API.                                                                                                                                                                                                                                              |
| `basePath`  | `string`                                          | `''`    | URL prefix stripped from `request.url` before routing. Set to the mount path (e.g. `/storage`) when mounting at a sub-path.                                                                                                                                                                                   |
| `onError`   | `(error: unknown) => void`                        | —       | Called with each fatal error before the JSON:API error response is returned. Use for logging or Sentry breadcrumbs.                                                                                                                                                                                           |
| `logger`    | `Pick<Console, 'error'\|'warn'\|'info'\|'debug'>` | —       | Passed to the JSON:API error serialiser for structured error logging.                                                                                                                                                                                                                                         |
| `authorize` | `StorageAuthorize`                                | —       | **Required.** Per-action authorization policy. Runs before every action (including the OpenAPI routes) with the action descriptor and originating `Request`. Return `true` to allow, `false` for 403, or a `LaikaError` for a custom status/message. Pass `allowAll` to declare a surface intentionally open. |

## Partial success: `meta.warnings`

Every response — single-resource, collection, void (delete), and per-result inside `atomic:results`
— may carry a `meta.warnings` array. Each entry is a JSON:API error object describing a non-fatal
recoverable issue surfaced by the backing repository. Common producers: an R2 eventual-consistency
readback fell back to a synthesised resource, a corrupt row was skipped during a list, a sub-folder
was unreadable during a recursive walk.

`meta.warnings` is **additive** to the success of the operation. The response status is still `200`
(or `201` for the create path); the resource you asked for is delivered; the warnings list tells you
what else didn't go cleanly. Fatal failures continue to populate the top-level `errors` array with a
non-2xx status.

```jsonc
{
  "data": { "type": "object", "id": "notes/hello", "attributes": {/* ... */} },
  "meta": {
    "warnings": [
      {
        "code": "not_found",
        "status": "404",
        "title": "Not Found",
        "detail": "readback failed; synthesized from write input"
      }
    ]
  }
}
```

Proxy backends (`@laikacms/storage/jsonapi-proxy` etc.) read `meta.warnings` from the upstream
response and re-emit each entry as a `LaikaTask` / `LaikaStream` `recoverableError`, so warnings
survive arbitrary proxy chains end-to-end.
