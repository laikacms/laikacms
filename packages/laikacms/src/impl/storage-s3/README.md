# `laikacms/storage/s3`

An adapter that makes any S3-compatible object store — AWS S3, Cloudflare R2 (via its S3 endpoint),
MinIO, Backblaze B2, DigitalOcean Spaces, or any other S3-API-shaped service — look like an
`R2Bucket`, so the existing `R2StorageRepository` can be reused unchanged as a `StorageRepository`
on top of it.

This module is a pure storage adapter with no `@laikacms/decap` dependency and no hard dependency on
`@aws-sdk/client-s3` — the SDK client and command constructors are passed in by the caller, so
callers who don't use S3 never pull the AWS SDK into their bundle.

## Usage

```ts
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { jsonSerializer } from 'laikacms/serializers/json';
import { R2StorageRepository } from 'laikacms/storage/r2';
import { createS3Bucket } from 'laikacms/storage/s3';

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
});

const bucket = createS3Bucket({
  client: s3,
  bucketName: 'my-content',
  commands: {
    HeadObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
  },
});

const repo = new R2StorageRepository(bucket, { json: jsonSerializer }, 'json');
```

Pair the resulting `bucket` with the lower-level `decapApi` directly, or with `createCustomLaika`
from `@laikacms/decap/custom`.

### `createS3Bucket` options (`CreateS3BucketOptions`)

| Option       | Type           | Required | Default | Description                                                                                                                                                                                                                |
| ------------ | -------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client`     | `S3ClientLike` | Yes      | —       | Anything implementing the AWS SDK v3 `S3Client.send(command)` surface — the real `@aws-sdk/client-s3` `S3Client`, or a mock client shaped the same way for tests.                                                          |
| `bucketName` | `string`       | Yes      | —       | The S3 bucket name to read from and write to.                                                                                                                                                                              |
| `commands`   | `S3Commands`   | Yes      | —       | The `HeadObjectCommand`, `GetObjectCommand`, `PutObjectCommand`, `DeleteObjectCommand`, and `ListObjectsV2Command` constructors imported from `@aws-sdk/client-s3`, passed in so this module never imports the SDK itself. |
| `keyPrefix`  | `string`       | No       | `''`    | Prefix prepended to every key before it's sent to S3, and stripped back off keys returned from `list()`. Useful for scoping one bucket to multiple tenants.                                                                |

`createS3Bucket` returns an `R2BucketLike` implementing the 5-method subset of the Cloudflare R2
bucket API that `R2StorageRepository` uses: `head`, `get`, `put`, `delete`, and `list`.

## How it works

- **404 handling.** `head` and `get` return `null` (rather than throwing) when the underlying S3
  client's error indicates a missing object — detected either by error `name` (`NotFound` /
  `NoSuchKey`) or by `$metadata.httpStatusCode === 404`. Any other error is rethrown.
- **`list` semantics.** `prefix`, `delimiter`, `cursor`, and `limit` map directly onto S3's
  `Prefix`, `Delimiter`, `ContinuationToken`, and `MaxKeys`. When `keyPrefix` is set, it's combined
  with the caller's `prefix` on the way out and stripped back off `Contents`/`CommonPrefixes` keys
  on the way back, so callers of the resulting bucket never see the prefix.
  `IsTruncated`/`NextContinuationToken` map onto the returned `truncated`/`cursor`.
- **`put` return value.** S3's `PutObjectCommand` response doesn't carry back the object's size or
  etag the way R2's `put` does, so the adapter synthesizes a minimal object
  (`{ key, size: 0, etag: '' }`) for API parity with `R2BucketLike`.

## What this does not do

- It is not itself a `StorageRepository` — it only produces the `R2BucketLike` bucket that
  `R2StorageRepository` (from `laikacms/storage/r2`) needs. All storage-layer behaviour (folder
  simulation via key prefixes, `.keep` markers, extension handling, ignore lists, pagination) is
  implemented by `R2StorageRepository`, not by this adapter — see its own documentation for that.
- It does not manage S3 credentials or client configuration; both are the caller's responsibility
  via the `client` it passes in.
