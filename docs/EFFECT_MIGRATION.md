# Effect Migration Guide

## Overview

This document explains the migration from the custom `Result` type to Effect's `Result` type in the Laika CMS codebase.

## What Changed

### Old Pattern (Custom Result)

The old pattern used a custom `Result` type with helper functions:

```typescript
import { Result, success, failure, ErrorResult, ResultError } from '@laikacms/core';

// Creating results
const successResult = success(data);
const failureResult = failure(ErrorCode, ['error message']);

// Checking results
if (result.success) {
  console.log(result.data);
} else {
  console.log(result.code, result.messages);
}
```

### New Pattern (Effect Result)

The new pattern uses Effect's `Result` type:

```typescript
import { LaikaResult, LaikaError, NotFoundError, InternalError } from '@laikacms/core';
import * as Result from 'effect/Result';

// Creating results
const successResult = Result.succeed(data);
const failureResult = Result.fail(new NotFoundError('Resource not found'));

// Checking results
if (Result.isSuccess(result)) {
  console.log(result.success);  // Note: .success not .data
} else {
  console.log(result.failure);  // Note: .failure not .code/.messages
}
```

## Key Differences

| Old Pattern | New Pattern |
|-------------|-------------|
| `success(data)` | `Result.succeed(data)` |
| `failure(code, messages)` | `Result.fail(new ErrorClass(message))` |
| `result.success` (boolean) | `Result.isSuccess(result)` |
| `result.data` | `result.success` |
| `result.code` | `result.failure.code` |
| `result.messages` | `result.failure.message` |

## Type Definitions

The `LaikaResult<T>` type is defined in `@laikacms/core`:

```typescript
// packages/shared/core/src/domain/types/effect.ts
import type { Result } from "effect/Result";
import { LaikaError } from "../entities";

export type LaikaResult<T> = Result<T, LaikaError>;
```

## ResultStream Pattern

Repository methods now return `ResultStream<T>` which is an async generator:

```typescript
type ResultStream<T> = AsyncGenerator<LaikaResult<T>>;
```

### Converting Methods to Async Generators

Old pattern:
```typescript
async getObject(key: string): Promise<Result<StorageObject>> {
  const result = await this.datasource.get(key);
  if (!result.success) return result;
  return success(result.data);
}
```

New pattern:
```typescript
async *getObject(key: string): AsyncGenerator<LaikaResult<StorageObject>> {
  const result = await this.datasource.get(key);
  if (Result.isFailure(result)) {
    yield failAs<StorageObject>(result.failure);
    return;
  }
  yield Result.succeed(result.success);
}
```

### Helper Function for Type Conversion

When yielding a failure from a different result type, use a helper function:

```typescript
function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
}
```

This is needed because Effect's Result type has covariant type parameters.

## Consuming Async Generators

When calling methods that return `ResultStream<T>`:

```typescript
// Old pattern
const result = await repository.getObject(key);
if (result.success) {
  console.log(result.data);
}

// New pattern
for await (const result of repository.getObject(key)) {
  if (Result.isSuccess(result)) {
    console.log(result.success);
  }
}

// Or using yield* to delegate
async *getAtom(key: string): AsyncGenerator<LaikaResult<Atom>> {
  yield* this.getObject(key);  // Delegates to another generator
}
```

## Package Dependencies

Packages that use Effect's Result need to add `effect` as a dependency:

```json
{
  "dependencies": {
    "effect": "catalog:default"
  }
}
```

## Files Modified

The following packages were updated as part of this migration:

- `@laikacms/core` - Removed old Result type, added LaikaResult type
- `@laikacms/assets-r2` - Updated datasource and repository
- `@laikacms/storage-r2` - Updated datasource and repository
- `@laikacms/storage-fs` - Updated datasource and repository
- `@laikacms/documents-contentbase` - Updated repository (pending)

## Common Errors

### "Property 'success' does not exist on type 'Failure'"

This means you're using the old `.success` boolean check. Use `Result.isSuccess()` instead.

### "Property 'data' does not exist on type 'Success'"

Effect's Result uses `.success` to access the value, not `.data`.

### "Type 'Failure<A, E>' is not assignable to type 'LaikaResult<B>'"

When yielding a failure from a different result type, use the `failAs<T>()` helper.

## References

- [Effect Result Documentation](https://effect.website/docs/data-types/result)
- Effect version: See `pnpm-workspace.yaml` catalog for version
