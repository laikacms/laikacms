# DynamoDB

`@laikacms/aws/storage-ddb` is a DynamoDB single-table `StorageRepository`, and
`@laikacms/aws/catalog-ddb` backs [Catalog](../concepts/catalog) settings with DynamoDB. Use them
for serverless AWS stacks where content should live next to your Lambda functions with
single-digit-millisecond reads.

## Install

```bash
pnpm add @laikacms/aws
```

```ts
import {/* storage */} from '@laikacms/aws/storage-ddb';
import {/* catalog  */} from '@laikacms/aws/catalog-ddb';
```

Like the [S3 implementations](./s3), the AWS SDK client is passed in by the caller — nothing pulls
`@aws-sdk/*` into bundles that don't use it.

`@laikacms/aws` is developed in its own repository; see the
[`@laikacms/aws` package on npm](https://www.npmjs.com/package/@laikacms/aws) for the full
constructor reference.

## Capability notes

- Single-table design: keys map to partition/sort keys, folder listings are prefix queries.
- Pairs naturally with `@laikacms/aws/assets-s3` for binary media.
