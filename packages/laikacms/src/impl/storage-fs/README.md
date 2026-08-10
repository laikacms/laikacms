# `laikacms/storage/fs`

A `StorageRepository` implementation backed by the local (or server) filesystem via Node's
`fs/promises`. Objects are stored as files, folders as directories, and empty folders as `.keep`
markers — the same simulated-hierarchy convention used by every other `StorageRepository`
implementation in this package.

## Why filesystem storage?

It's the simplest possible backend: no external service, no credentials, just files on disk. Good
fit for local development, CLIs (`laikacli local serve` uses it), self-hosted deployments that
already have a persistent volume, and as a real, non-mocked backend for tests. It also has the
richest capability set of any implementation here — it's the only backend with live filesystem
change notifications (`subscribeChanges`, via `fs.watch`).

## Usage

```ts
import { runTask } from 'laikacms/compat';
import { jsonSerializer } from 'laikacms/serializers/json';
import { FileSystemStorageRepository } from 'laikacms/storage/fs';

const repo = new FileSystemStorageRepository(
  '/path/to/content', // root directory — every key is resolved relative to this
  { json: jsonSerializer }, // serializerRegistry
  'json', // defaultFileExtension
);

const post = await runTask(repo.getObject('posts/hello-world'));
```

### Constructor parameters

`FileSystemStorageRepository` takes positional constructor arguments (not an options object):

| Parameter              | Position | Required | Default                                                                                                        | Description                                                                                                                         |
| ---------------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `rootDirectory`        | 1st      | yes      | —                                                                                                              | Absolute (or process-relative) directory every key resolves under. Created lazily by write operations; never deleted by this class. |
| `serializerRegistry`   | 2nd      | yes      | —                                                                                                              | Maps file extension → `StorageSerializer`, same as every other `StorageRepository`.                                                 |
| `defaultFileExtension` | 3rd      | yes      | —                                                                                                              | Extension used for newly created objects when no other extension is determined. A leading `.` is stripped if present.               |
| `ignoreList`           | 4th      | no       | `['**/.keep', '**/.gitkeep', '**/.DS_Store', '**/Thumbs.db', '**/desktop.ini', '**/.catalog', '**/.laikacms']` | Glob patterns excluded from listings and from `subscribeChanges` notifications.                                                     |
| `determineExtension`   | 5th      | no       | `defaultDetermineExtension`                                                                                    | Callback overriding how the on-write extension is chosen. Same contract as the other repositories' `determineExtension`.            |

## Behaviour notes

- **Folder simulation.** Directories map to folders one-to-one; an empty directory is represented on
  disk by a `.keep` file so it survives round-trips through backends that can't store empty
  directories natively.
- **Extension handling.** Keys never carry a file extension in the public API —
  `getObject('posts/a')` resolves whichever registered extension exists on disk (`posts/a.json`,
  `posts/a.md`, …). `createObject` fails with `EntryAlreadyExistsError` if an object already exists
  under any registered extension.
- **Deletes.** `removeAtoms` resolves each key to its on-disk path (trying each registered extension
  in turn) before deleting, so `releases/v1.2-notes` isn't misparsed as having a `.2-notes`
  extension.
- **Live change notifications.** `subscribeChanges` lazily starts a single recursive `fs.watch` on
  `rootDirectory`, shared by all subscribers. Emissions are debounced (50ms) and coalesced by key,
  so a burst of writes to one file yields a single change event; a rename surfaces as a delete of
  the old key plus an add of the new key. The watch handle is closed once the last subscriber
  unsubscribes.
- **Capabilities.** `getCapabilities()` reports pagination as in-memory offset/page slicing (no
  cursor support) and `changes.subscription: true` with no sync token or change feed.

## Testing

`packages/laikacms/src/impl/storage-fs/testing/index.ts` exports `storagefsContractCase`, a
`StorageContractCase` that backs a real `FileSystemStorageRepository` with a fresh OS tmp directory
(`fs.mkdtemp`) — see the [storage testkit convention](./testing/README.md) for how to write your
own.
