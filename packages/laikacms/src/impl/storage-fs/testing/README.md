# Storage testkit convention

## What is a testkit?

A **testkit** wires a _real_ `StorageRepository` implementation to an _ephemeral/fake backend_ so
the shared contract harness can run every contract test against the actual code.

A testkit is **not** a mock of the repository class itself. Mocking the repo would only test that
the mock matches the mock — useless. Instead, a testkit provides:

1. A real instance of the repository class under test.
2. A cheap, isolated backend (tmp directory, in-memory store, test bucket, …).

## `StorageContractCase` shape

```ts
// packages/laikacms/src/domain/storage/testing/contract.ts
export interface StorageContractCase {
  name: string;
  makeRepo(): Promise<StorageRepository>;
  teardown?(): Promise<void>;
}
```

| Field      | Required | Description                                                                       |
| ---------- | -------- | --------------------------------------------------------------------------------- |
| `name`     | yes      | Label shown in test output                                                        |
| `makeRepo` | yes      | Create the backend and return a ready repository                                  |
| `teardown` | no       | Cleanup hook called after all tests; omit when the backend is naturally ephemeral |

## Registering your testkit

Add your `StorageContractCase` to the registry in
`packages/laikacms/src/domain/storage/testing/registry.ts`:

```ts
import { storagefsContractCase } from '../../../impl/storage-fs/testing/index.js';
import { myNewContractCase } from '../../../impl/storage-my-backend/testing/index.js';
import type { StorageContractCase } from './contract.js';

export const storageContractRegistry: StorageContractCase[] = [
  storagefsContractCase,
  myNewContractCase,
];
```

## Copy-paste template

Create `packages/laikacms/src/impl/storage-<backend>/testing/index.ts`:

```ts
// Testkit for <BackendName>StorageRepository.
import type { StorageContractCase } from '../../../domain/storage/testing/contract.js';
import { MyStorageRepository } from '../infrastructure/repositories/my-repository.js';

export const myContractCase: StorageContractCase = {
  name: 'MyStorageRepository',

  async makeRepo() {
    // Set up ephemeral backend state here (tmp dir, in-memory store, …).
    const backend = await createEphemeralBackend();
    return new MyStorageRepository(backend);
  },

  // Only needed if makeRepo() allocates resources that must be freed.
  async teardown() {
    await cleanupEphemeralBackend();
  },
};
```

## Reference implementation

See `packages/laikacms/src/impl/storage-fs/testing/index.ts` for the reference implementation. It
creates an OS tmp directory with `fs.mkdtemp` and passes a minimal `rawSerializer` registry — no
teardown needed because the OS reclaims tmp directories.
