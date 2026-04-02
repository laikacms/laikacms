# @laikacms/storage-api

[![npm](https://img.shields.io/npm/v/@laikacms/storage-api)](https://www.npmjs.com/package/@laikacms/storage-api)
[![npm](https://img.shields.io/npm/dm/@laikacms/storage-api)](https://www.npmjs.com/package/@laikacms/storage-api)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@laikacms/storage-api)](https://bundlephobia.com/result?p=@laikacms/storage-api)

JSON:API server for storage operations.

## Installation

```bash
pnpm add @laikacms/storage-api
```

## Usage

```typescript
import { buildJsonApi } from '@laikacms/storage-api'

const api = buildJsonApi({ repo: myStorageRepo })

// Use with any runtime
export default { fetch: api.fetch }
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/atoms/{folder}` | List atoms |
| GET | `/atom-summaries/{folder}` | List summaries |
| POST | `/objects` | Create object |
| PATCH | `/objects/{key}` | Update object |
| POST | `/operations` | Atomic batch |

## Options

```typescript
interface StorageApiOptions {
  repo: StorageRepository
  basePath?: string
  onError?(error: unknown): void
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'>
}
```
