# storage-contract-e2e

A minimal, self-contained example app that demonstrates the `StorageRepository` contract pattern
from `laikacms`. No network, no real credentials needed.

## What is the StorageRepository contract?

`StorageRepository` is an abstract class defined in `laikacms/storage`. Any concrete implementation
(filesystem, R2, DynamoDB, WebDAV, …) must satisfy a shared behavioural contract:
create/read/update/delete objects and folders, list atoms, and report its capabilities.

The contract is captured in `runStorageRepositoryContract` (exported from
`laikacms/storage/testing`). It registers a Vitest `describe` block with a standard suite of tests.
Running those tests against an implementation proves that the implementation is interchangeable with
any other conforming implementation.

## How a testkit (faked backend) works

A "testkit" is a concrete `StorageRepository` backed by a controllable in-process store instead of a
real external system. The testkit:

1. Implements every abstract method of `StorageRepository`.
2. Keeps state in memory (or in a temp directory, or a SQLite file — whatever is easiest to spin up
   and tear down).
3. Is passed to `runStorageRepositoryContract` via `makeRepo`.

The contract suite calls `makeRepo()` before each suite run, so each run gets a fresh, empty store.

## The in-memory backend (`InMemoryStorageRepository`)

`src/in-memory-storage-repository.ts` implements all `StorageRepository` methods using a plain
`Map<string, StoredEntry>`. Keys are stored verbatim (no extension stripping or path normalisation),
making it suitable for contract-testing code that uses `.json` suffixes in keys.

## Swapping to another integration's testkit

Change the `makeRepo` factory in `src/contract.test.ts`:

```ts
import { MyOtherStorageRepository } from 'laikacms/storage-other';
import { runStorageRepositoryContract } from 'laikacms/storage/testing';

runStorageRepositoryContract({
  name: 'MyOtherStorageRepository',
  makeRepo: () => new MyOtherStorageRepository(/* config */),
  teardown: () => {/* cleanup if needed */},
});
```

## Running

```sh
# install deps from monorepo root
pnpm install

# type-check
pnpm --filter @laikacms/storage-contract-e2e typecheck

# build
pnpm --filter @laikacms/storage-contract-e2e build

# run contract tests
pnpm --filter @laikacms/storage-contract-e2e test
```

## CRUDL walkthrough

`src/walkthrough.ts` demonstrates the full Create→Read→Update→List→Delete cycle using the public
`laikacms/compat` API (`runTask` / `collectStream`). It is also a useful starting point when
building integrations against `laikacms`.
