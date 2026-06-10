# laikacms/core

[![npm](https://img.shields.io/npm/v/laikacms/core)](https://www.npmjs.com/package/laikacms/core)
[![npm](https://img.shields.io/npm/dm/laikacms/core)](https://www.npmjs.com/package/laikacms/core)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/laikacms/core)](https://bundlephobia.com/result?p=laikacms/core)

Core types, errors, and utilities for Laika CMS.

## Installation

```bash
pnpm add laikacms/core
```

## Usage

```typescript
import { InvalidData, LaikaError, LaikaResult, NotFoundError } from 'laikacms/core';
```

## Error Types

- `NotFoundError` - Resource not found
- `InvalidData` - Invalid input data
- `InternalError` - Internal server error
- `AuthenticationError` - Not logged in; HTTP 401
- `AuthorizationError` - HTTP 401; used to deserialize or signal an unauthenticated challenge from a
  remote server. Not for "logged in but no permission" — use `ForbiddenError` for that.
- `ForbiddenError` - Logged in but lacks permissions; HTTP 403

> **Usage guidance:** use `AuthenticationError` when the user is not logged in at all (HTTP 401);
> use `ForbiddenError` when the user is logged in but lacks permissions (HTTP 403); use
> `AuthorizationError` when deserializing a 401 from a remote server.

## Result Type

```typescript
type LaikaResult<T> = Result<T, LaikaError>;
```

Compatible with Effect's `Result` type. Use the `laikacms/compat` helpers (`runTask`,
`collectStream`) to consume tasks/streams without importing Effect directly.

## Compat helpers (`laikacms/compat`)

Promise wrappers for `LaikaTask` and `LaikaStream` — no `effect` import needed at the call site.

```typescript
import { collectStream, runTask } from 'laikacms/compat';

// Run a LaikaTask to completion — resolves with the value or rejects with a LaikaError
const object = await runTask(repository.getObject(key));

// Collect all data items from a LaikaStream — resolves with { items, done }
const { items, done } = await collectStream(repository.listObjects(prefix));
console.log(items); // StorageObject[]
console.log(done); // { total?: number; pagination?: Pagination }
```
