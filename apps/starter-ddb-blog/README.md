# starter-ddb-blog

A minimal blog starter backed by **AWS DynamoDB** as the LaikaCMS storage backend.

Content lives in a single DynamoDB table using `DdbStorageRepository` from
`@laikacms/aws/storage-ddb`. The admin UI is served from the Decap CDN (no build step required).

## Stack

- **Runtime**: Node.js 22
- **Server**: Hono + `@hono/node-server`
- **Storage**: AWS DynamoDB via `@laikacms/aws/storage-ddb`
- **CMS**: Decap Admin from CDN

## Quick start

### 1. Create the DynamoDB table

```bash
aws dynamodb create-table \
  --table-name laika_storage \
  --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### 2. Configure AWS credentials

Standard AWS credential resolution applies — use whichever method suits your environment:

```bash
# Explicit environment variables
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=<key>
export AWS_SECRET_ACCESS_KEY=<secret>

# Or use a named profile
export AWS_PROFILE=my-profile
export AWS_REGION=us-east-1
```

### 3. Build workspace dependencies

```bash
pnpm build
```

### 4. Start the dev server

```bash
pnpm dev
```

Open http://localhost:3000/admin/ to manage content.

## Local development with DynamoDB Local

Run DynamoDB Local in Docker:

```bash
docker run -p 8000:8000 amazon/dynamodb-local
```

Create the table against the local endpoint:

```bash
AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local aws dynamodb create-table \
  --endpoint-url http://localhost:8000 \
  --table-name laika_storage \
  --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

Start the blog:

```bash
AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local \
AWS_REGION=us-east-1 DDB_ENDPOINT=http://localhost:8000 pnpm dev
```

## Environment variables

| Variable       | Default         | Description                                |
| -------------- | --------------- | ------------------------------------------ |
| `AWS_REGION`   | _(required)_    | AWS region for the DynamoDB table          |
| `DDB_TABLE`    | `laika_storage` | DynamoDB table name                        |
| `DDB_ENDPOINT` | _(AWS default)_ | Override endpoint URL (e.g. for local DDB) |
| `PORT`         | `3000`          | HTTP port                                  |

Standard AWS credential env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_PROFILE`, etc.)
are also respected.

## DynamoDB table schema

The table uses a single-table design:

| Attribute   | Type   | Description                               |
| ----------- | ------ | ----------------------------------------- |
| `PK`        | String | Partition key: `STORAGE#<parentFolder>`   |
| `SK`        | String | Sort key: `<filename.ext>` or folder name |
| `Type`      | String | `"file"` or `"folder"`                    |
| `Content`   | String | Serialized file content (files only)      |
| `Extension` | String | File extension (files only)               |
| `CreatedAt` | String | ISO 8601 timestamp                        |
| `UpdatedAt` | String | ISO 8601 timestamp                        |
| `ETag`      | String | Per-write revision tag                    |

## Patterns used

### `createCustomLaika` + `DdbStorageRepository`

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DdbStorageRepository } from '@laikacms/aws/storage-ddb';
import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const storage = new DdbStorageRepository({
  docClient,
  tableName: 'laika_storage',
  serializerRegistry: { md: markdownSerializer, ... },
  defaultFileExtension: 'md',
});

export const laika = createCustomLaika({ storage, decapConfig: {...}, basePath: '/api/decap', auth: { mode: 'dev' } });
export const adminHtml = decapAdminHtml();
```

### Hono pass-through (zero bridging)

```ts
app.all('/api/decap/*', c => laika.fetch(c.req.raw));
```

Hono's `c.req.raw` is already a WHATWG `Request` — no adapter needed.

## Doc gaps surfaced

1. **`DdbStorageRepository` not documented**: The `@laikacms/aws/storage-ddb` package lacks a README
   or docs page. The constructor options (`partitionPrefix`, `pkAttribute`, `skAttribute`) are only
   discoverable by reading source. → Docs needed.
2. **No `DDB_ENDPOINT` mention in DynamoDB docs**: Using `DynamoDBClient({ endpoint })` for local
   dev is the standard override but nowhere in LaikaCMS docs is it mentioned. → Docs needed.
3. **`DynamoDBDocumentClient.from(client)` vs direct instantiation**: It's non-obvious that LaikaCMS
   requires `DynamoDBDocumentClient` (from `@aws-sdk/lib-dynamodb`), not the lower-level
   `DynamoDBClient`. The type signature makes it clear but no docs explain why. → Docs needed.
