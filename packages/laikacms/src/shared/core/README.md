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
- `UnauthorizedError` - Authentication required
- `ForbiddenError` - Access denied

## Result Type

```typescript
type LaikaResult<T> = Result<T, LaikaError>;
```

Compatible with Effect's Result type internally, but exposed via Standard Schema for
interoperability with Zod, Valibot, etc.

## Compat helpers (`@laikacms/core/compat`)

Non-Effect wrappers for consuming `AsyncGenerator<LaikaResult<T>>` streams from repository methods.

```typescript
import { collectStream, runTask } from '@laikacms/core/compat';

// Await the first success, or throw on failure / empty stream
const object = await runTask(repository.getObject(key));

// Collect all successes into an array, or throw on first failure
const objects = await collectStream(repository.listObjects(prefix));

// Optional progress callback
const result = await runTask(repository.putObject(key, data), {
  onProgress: r => console.log('progress', r),
});
```
