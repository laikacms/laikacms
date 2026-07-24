# laikacms/core

[![npm](https://img.shields.io/npm/v/laikacms)](https://www.npmjs.com/package/laikacms)
[![npm](https://img.shields.io/npm/dm/laikacms)](https://www.npmjs.com/package/laikacms)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/laikacms)](https://bundlephobia.com/result?p=laikacms)

Core types, errors, and utilities for Laika CMS.

## Installation

```bash
pnpm add laikacms
```

## Usage

```typescript
import { InvalidData, LaikaError, LaikaResult, NotFoundError } from 'laikacms/core';
```

## Error Types

All error classes extend `LaikaError` and carry `.status`, `.code`, and `.title` fields.

### General errors

- `NotFoundError` — Resource not found; HTTP 404
- `BadRequestError` — Duplicate key or invalid input that the caller can correct; HTTP 400
- `InvalidData` — Invalid input data; HTTP 400
- `ValidationError` — Schema / constraint validation failure; HTTP 400
- `InternalError` — Internal server error; HTTP 500
- `IllegalStateException` — Illegal internal state that should not occur; HTTP 500
- `NotImplementedError` — Feature not yet implemented; HTTP 501
- `UnknownError` — Error of unknown origin; HTTP 500

### Auth errors

- `AuthenticationError` — Not logged in; HTTP 401
- `AuthorizationError` — HTTP 401; used to deserialize or signal an unauthenticated challenge from a
  remote server. Not for "logged in but no permission" — use `ForbiddenError` for that.
- `ForbiddenError` — Logged in but lacks permissions; HTTP 403
- `AuthorizerFailureError` — API Gateway authorizer failed (infrastructure error); HTTP 500

> **Usage guidance:** use `AuthenticationError` when the user is not logged in at all (HTTP 401);
> use `ForbiddenError` when the user is logged in but lacks permissions (HTTP 403); use
> `AuthorizationError` when deserializing a 401 from a remote server.

### Conflict / state errors

- `EntryAlreadyExistsError` — Duplicate entry; HTTP 409
- `ConflictError` — Generic write conflict; HTTP 409
- `VersionMismatchError` — Optimistic-concurrency version conflict; HTTP 409

### Path / filesystem errors

- `DirInsteadOfFile` — Expected a file but found a directory; HTTP 403
- `FileInsteadOfDir` — Expected a directory but found a file; HTTP 403

### Rate-limit / availability errors

- `TooManyRequestsError` — Rate limit exceeded; HTTP 429
- `ServiceUnavailableError` — Upstream service unavailable; HTTP 503
- `GatewayTimeoutError` — Upstream gateway timed out; HTTP 504

### File-sanitizer errors

- `UnsupportedFileTypeError` — File type not allowed; HTTP 415
- `DangerousFileTypeError` — File type flagged as dangerous; HTTP 415
- `CorruptedFileError` — File data is corrupted; HTTP 422
- `EmbeddedContentError` — File contains disallowed embedded content; HTTP 422
- `FileTooLargeError` — File exceeds the size limit; HTTP 413

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
// `offset` is required for offset-style pagination; `{ limit: 100 }` alone would silently return the full list.
// `Pagination` is a union of PaginationOffsetSchema, PaginationPageBasedSchema, PaginationBeforeSchema, PaginationAfterSchema.
const { items, done } = await collectStream(
  repository.listAtoms(folderKey, { depth: 1, pagination: { offset: 0, limit: 100 } }),
);
console.log(items); // Atom[]
```
