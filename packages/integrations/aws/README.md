# @laikacms/aws

AWS service implementations for [Laika CMS](https://www.npmjs.com/package/laikacms).

```bash
pnpm add @laikacms/aws
```

## Exports

### `@laikacms/aws/contentbase-settings-ddb`

DynamoDB-backed `SettingsProvider` for contentbase settings.

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDbSettingsProvider } from '@laikacms/aws/contentbase-settings-ddb';

const settings = new DynamoDbSettingsProvider({
  client: new DynamoDBClient({ region: 'eu-west-1' }),
  tableName: 'laikacms-settings',
});
```

Pair with `laikacms/contentbase-api` to serve settings over JSON:API.

### `@laikacms/aws/storage-s3`

S3-backed `StorageRepository`. Mirrors `laikacms/storage-r2` (R2 is S3-API-compatible) but talks the
AWS SDK v3 (`@aws-sdk/client-s3`). Works against AWS S3, MinIO, LocalStack, Backblaze B2, Wasabi,
DigitalOcean Spaces, and anything else that speaks the S3 API.

```ts
import { S3Client } from '@aws-sdk/client-s3';
import { S3StorageRepository } from '@laikacms/aws/storage-s3';
import { storageSerializerMarkdown } from 'laikacms/storage-serializers-markdown';

const repo = new S3StorageRepository({
  client: new S3Client({ region: 'eu-west-1' }),
  bucket: 'esstudio-content',
  basePath: 'site-a', // optional — scope under a prefix
  serializerRegistry: { md: storageSerializerMarkdown },
  defaultFileExtension: 'md',
});
```

MinIO/LocalStack: pass `endpoint`, `forcePathStyle: true`, and explicit credentials on the
`S3Client`.

Behaviour notes:

- Hierarchical listings via `Delimiter: '/'`; empty folders are placeholder `.keep` objects (matches
  `storage-r2` / `storage-fs`).
- Keys are extension-free at the boundary — the on-bucket key is `<key>.<ext>` where `<ext>` is
  picked from the serializer registry.
- `metadata.revisionId` is the object's `ETag`.
- Pagination iterates `NextContinuationToken` to completion, then `offset`/`page` styles are applied
  in memory; cursor pagination is not supported.
- Errors map cleanly: `NoSuchKey`/404 → `NotFoundError`, 401 → `AuthenticationError`, 403 →
  `ForbiddenError`, 429 → `TooManyRequestsError`, 5xx → `ServiceUnavailableError`.

### `@laikacms/aws/assets-s3`

S3-backed `AssetsRepository`. Same backend as `@laikacms/aws/storage-s3` — same S3 client, same
bucket, same key model — but a different Laika contract. Pair the two on one bucket (separated by
`basePath`) and you get content storage **and** asset hosting from a single AWS resource.

```ts
import { S3Client } from '@aws-sdk/client-s3';
import { defaultS3AssetUrl, S3AssetsRepository } from '@laikacms/aws/assets-s3';

const client = new S3Client({ region: 'eu-west-1' });

const assets = new S3AssetsRepository({
  client,
  bucket: 'esstudio-content',
  basePath: 'assets', // optional — scope under a prefix
  urlFor: ({ key }) => `https://cdn.esstudio.com/${key}`, // CloudFront / custom CDN
  variations: [
    {
      name: 'thumbnail',
      url: ({ key }) => `https://cdn.esstudio.com/100x100/${key}`,
      width: 100,
      height: 100,
    },
    { name: 'medium', url: ({ key }) => `https://cdn.esstudio.com/800/${key}`, width: 800 },
  ],
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/avif'],
});
```

**Variations are pure URL transforms.** S3 doesn't process images — you pair this with CloudFront +
Lambda@Edge / Cloudflare Image Resizing / Imgix / your own resize worker, and each
`S3AssetVariationSpec` owns the function that turns the asset's S3 key into the variant's
deliverable URL. `getVariations` runs zero round-trips — every variant URL is constructed locally.

**Pair with `storage-s3` on the same bucket.** Different `basePath`s keep them apart:

```ts
const storage = new S3StorageRepository({ client, bucket, basePath: 'content', ... });
const assets  = new S3AssetsRepository( { client, bucket, basePath: 'assets',  ... });
```

`metadata.revisionId` carries the object's ETag; `getMetadata` upgrades to `ImageMetadata` (with
`width`/`height`) when the upload attached `customMetadata: {width, height}` hints. Otherwise it
returns `BinaryMetadata`.

### `@laikacms/aws/storage-ddb`

DynamoDB-backed `StorageRepository`. Single-table design — each row is one file or folder marker:

```
PK = "STORAGE#<parentKey>"      (partition per folder)
SK = "<basename>"               (file name with extension, or folder name)
Type = "file" | "folder"
Content, Extension              (files only)
CreatedAt, UpdatedAt
ETag                            (per-write tag → metadata.revisionId)
```

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DdbStorageRepository } from '@laikacms/aws/storage-ddb';
import { storageSerializerJson } from 'laikacms/storage-serializers-json';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'eu-west-1' }));

const repo = new DdbStorageRepository({
  docClient,
  tableName: 'laika-storage',
  partitionPrefix: 'TENANT_42#STORAGE#', // optional — namespace per tenant
  serializerRegistry: { json: storageSerializerJson },
  defaultFileExtension: 'json',
});
```

Why DynamoDB for storage rather than S3:

- **Per-item RCU/WCU costs scale predictably** — no S3 per-request friction at small scales.
- **Strong consistency by default** on `GetItem`/`Query`, so a write-then-read is guaranteed to see
  the write (S3 read-after-write is strong only for new objects).
- **Single-table fits naturally into existing DDB-based infra** alongside the
  `contentbase-settings-ddb` repository.

Trade-offs:

- 400 KB max item size (DynamoDB hard limit). Suitable for content; use the assets API for larger
  blobs.
- Listing a folder is a single `Query` against the parent partition — fast and bounded. Cursor
  pagination is not exposed yet; offset/page styles are emulated in memory after a natural-order
  sort.
- Folder markers are written explicitly (`Type: 'folder'`) so missing-vs-empty is distinguishable,
  matching the contract every other `StorageRepository` honors.

## Companion packages

- [`laikacms`](https://www.npmjs.com/package/laikacms) — core domain, APIs, serializers
- [`@laikacms/github`](https://www.npmjs.com/package/@laikacms/github) — GitHub storage
- [`@laikacms/decap`](https://www.npmjs.com/package/@laikacms/decap) — Decap CMS integrations

## Documentation

See the [laikacms repository](https://github.com/laikacms/laikacms) for full docs.

## License

MIT
