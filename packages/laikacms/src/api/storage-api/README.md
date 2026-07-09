# laikacms/storage/api

[![npm](https://img.shields.io/npm/v/laikacms)](https://www.npmjs.com/package/laikacms)
[![npm](https://img.shields.io/npm/dm/laikacms)](https://www.npmjs.com/package/laikacms)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/laikacms)](https://bundlephobia.com/result?p=laikacms)

JSON:API server for storage operations.

## ⚠️ Authentication

`buildJsonApi` ships **no authentication middleware**. The handler will gladly read, create, update,
and delete storage objects for any caller that can reach its `fetch`. Do **not** expose it to
untrusted networks directly.

Wrap it with an authentication layer — e.g. [`@laikacms/decap/decap-api`](../../decap/decap-api),
which validates a Bearer access token before forwarding to this handler — or provide your own
middleware:

```typescript
const api = buildJsonApi({ repo: myStorageRepo });

export default {
  async fetch(request: Request) {
    const user = await myAuth(request);
    if (!user) return new Response('Unauthorized', { status: 401 });
    return api.fetch(request);
  },
};
```

## Installation

```bash
pnpm add laikacms
```

## Usage

```typescript
import { buildJsonApi } from 'laikacms/storage/api';

const api = buildJsonApi({ repo: myStorageRepo });

// Wrap with authentication before exposing publicly — see warning above.
export default { fetch: api.fetch };
```

## Endpoints

| Method | Path                       | Description                   |
| ------ | -------------------------- | ----------------------------- |
| GET    | `/`                        | API info + endpoint discovery |
| GET    | `/capabilities`            | Repository capabilities       |
| POST   | `/atoms`                   | Create a folder               |
| GET    | `/atoms/{folder}`          | List atoms                    |
| GET    | `/atom-summaries/{folder}` | List atom summaries           |
| GET    | `/objects/{key}`           | Read a storage object         |
| POST   | `/objects`                 | Create object                 |
| PATCH  | `/objects/{key}`           | Update object                 |
| GET    | `/folders/{key}`           | Read a folder                 |
| POST   | `/operations`              | Atomic batch operations       |

## Options

```typescript
interface StorageApiOptions {
  repo: StorageRepository;
  basePath?: string;
  onError?(error: unknown): void;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'>;
}
```

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
