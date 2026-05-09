# @laikacms/storage-api

[![npm](https://img.shields.io/npm/v/@laikacms/storage-api)](https://www.npmjs.com/package/@laikacms/storage-api)
[![npm](https://img.shields.io/npm/dm/@laikacms/storage-api)](https://www.npmjs.com/package/@laikacms/storage-api)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@laikacms/storage-api)](https://bundlephobia.com/result?p=@laikacms/storage-api)

JSON:API server for storage operations.

## ⚠️ Authentication

`buildJsonApi` ships **no authentication middleware**. The handler will gladly read, create, update,
and delete storage objects for any caller that can reach its `fetch`. Do **not** expose it to
untrusted networks directly.

Wrap it with an authentication layer — e.g. [`@laikacms/decap-api`](../../decap/decap-api), which
validates a Bearer access token before forwarding to this handler — or provide your own middleware:

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
pnpm add @laikacms/storage-api
```

## Usage

```typescript
import { buildJsonApi } from '@laikacms/storage-api';

const api = buildJsonApi({ repo: myStorageRepo });

// Wrap with authentication before exposing publicly — see warning above.
export default { fetch: api.fetch };
```

## Endpoints

| Method | Path                       | Description    |
| ------ | -------------------------- | -------------- |
| GET    | `/atoms/{folder}`          | List atoms     |
| GET    | `/atom-summaries/{folder}` | List summaries |
| POST   | `/objects`                 | Create object  |
| PATCH  | `/objects/{key}`           | Update object  |
| POST   | `/operations`              | Atomic batch   |

## Options

```typescript
interface StorageApiOptions {
  repo: StorageRepository;
  basePath?: string;
  onError?(error: unknown): void;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'>;
}
```
