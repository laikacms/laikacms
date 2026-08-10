# `laikacms/storage/r2`

A `StorageRepository` implementation backed by a Cloudflare R2 bucket (or anything shaped like the
Workers `R2Bucket` binding). R2 is a flat object store, so this implementation simulates a
hierarchical file system on top of it: folders are key prefixes, empty folders are `.keep` objects,
and file extensions are handled transparently.

## Why R2?

R2 storage is one of the two flagship backends for LaikaCMS: zero egress fees, S3-compatible API,
and it runs natively alongside a Cloudflare Workers deployment. It requires an `R2Bucket` binding
(from `@cloudflare/workers-types`, an optional peer dependency of this package), so it's typically
used from a Worker — a `wrangler.toml` R2 bucket binding, or any object implementing the same
`head`/`get`/`put`/`delete`/`list` surface (see `laikacms/storage/s3`'s `createS3Bucket()` for an
adapter that lets any S3-compatible store — including R2 via its S3 endpoint — pass as an
`R2Bucket`-like object).

## Usage

```ts
import { runTask } from 'laikacms/compat';
import { jsonSerializer } from 'laikacms/serializers/json';
import { R2StorageRepository } from 'laikacms/storage/r2';

export default {
  async fetch(request: Request, env: { CONTENT_BUCKET: R2Bucket }) {
    const repo = new R2StorageRepository(
      env.CONTENT_BUCKET, // R2Bucket binding
      { json: jsonSerializer }, // serializerRegistry
      'json', // defaultFileExtension
    );

    const post = await runTask(repo.getObject('posts/hello-world'));
    return Response.json(post);
  },
};
```

### Constructor parameters

`R2StorageRepository` takes positional constructor arguments (not an options object):

| Parameter              | Position | Required | Default                                                                                         | Description                                                                                                              |
| ---------------------- | -------- | -------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `bucket`               | 1st      | yes      | —                                                                                               | An `R2Bucket` (the Workers binding, or any object implementing the same `head`/`get`/`put`/`delete`/`list` methods).     |
| `serializerRegistry`   | 2nd      | yes      | —                                                                                               | Maps file extension → `StorageSerializer`, same as every other `StorageRepository`.                                      |
| `defaultFileExtension` | 3rd      | yes      | —                                                                                               | Extension used for newly created objects when no other extension is determined.                                          |
| `ignoreList`           | 4th      | no       | `['**/.keep', '**/.DS_Store', '**/Thumbs.db', '**/desktop.ini', '**/.catalog', '**/.laikacms']` | Glob patterns excluded from listings.                                                                                    |
| `determineExtension`   | 5th      | no       | `defaultDetermineExtension`                                                                     | Callback overriding how the on-write extension is chosen. Same contract as the other repositories' `determineExtension`. |

## Behaviour notes

- **Folder simulation.** Directories don't exist natively in R2; a folder is inferred from key
  prefixes, and an empty folder is represented by a `.keep` object so it survives listing.
- **`createdAt` survives overwrites.** R2's `uploaded` timestamp resets on every `put`, which would
  otherwise clobber an object's original creation time on update. This repository stores the
  original `createdAt` in R2 custom metadata (`x-laika-created-at`) on create, and carries it
  forward on every subsequent `updateObject`.
- **Eventual consistency on writes.** After `createObject`/`createOrUpdateObject` writes, the
  repository tries to read the object back to return the canonical server-side view. If R2's
  eventual-consistency window means the readback briefly fails, it emits a recoverable warning and
  synthesizes the returned `StorageObject` from the write input instead of failing — the data that
  was written is durable even if it isn't immediately readable.
- **Extension handling.** Keys never carry a file extension in the public API —
  `getObject('posts/a')` resolves whichever registered extension exists in the bucket.
  `createObject` fails with `EntryAlreadyExistsError` if an object already exists under any
  registered extension.
- **Capabilities.** `getCapabilities()` reports pagination as in-memory offset/page slicing (no
  cursor support) and `changes: unsupportedChanges` — R2 has no live change notifications, so
  `subscribeChanges` is not supported by this implementation.

## Testing

`packages/laikacms/src/impl/storage-r2/testing.ts` exports `r2StorageContractCase`, a
`StorageContractCase` that backs a real `R2StorageRepository` with an in-memory `R2Bucket` stub —
see the [storage testkit convention](../storage-fs/testing/README.md) for how to write your own.
(The `removeAtoms` contract test is skipped for this backend: R2's `delete` is idempotent, so it
can't distinguish removed-vs-skipped keys.)
