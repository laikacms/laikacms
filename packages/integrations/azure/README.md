# `@laikacms/azure`

Azure service implementations for Laika CMS. Each subpath export is independent — there is no
umbrella entry — so consumers only pay for the SDK they actually use. `@azure/storage-blob` is
listed as an **optional peer** alongside the package; add it to your project only if you wire up the
blob storage subpath.

## `@laikacms/azure/storage-blob`

A `StorageRepository` backed by Azure Blob Storage. Completes the cloud-storage trio alongside
`@laikacms/aws/storage-s3` (AWS) and `@laikacms/google/storage-drive` (GCP).

The shape mirrors `storage-s3`: a flat container with simulated `/`-delimited folders, `.keep`
placeholders so empty folders surface in listings, blob ETag exposed as `metadata.revisionId`.

```ts
import { BlobServiceClient } from '@azure/storage-blob';
import { AzureBlobStorageRepository, azureContainerOps } from '@laikacms/azure/storage-blob';
import { storageSerializerMarkdown } from 'laikacms/storage-serializers-markdown';

const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING!,
);
const containerClient = blobServiceClient.getContainerClient('laika-content');

const repo = new AzureBlobStorageRepository({
  ops: azureContainerOps(containerClient),
  basePath: 'site-a', // optional — scope under a prefix
  serializerRegistry: { md: storageSerializerMarkdown },
  defaultFileExtension: 'md',
});
```

### The `BlobOps` abstraction

The repository doesn't depend on `@azure/storage-blob` directly. It consumes a small `BlobOps`
interface — six methods (`exists`, `getProperties`, `download`, `upload`, `delete`,
`listByHierarchy`). The factory `azureContainerOps(containerClient)` adapts the SDK to that
interface.

That means:

- **Tests don't need an SDK mock.** Pass a plain object literal satisfying `BlobOps`.
  Stream-handling lives entirely in the adapter, not in the datasource.
- **You can swap in a different Azure-compatible store** (Azurite, MinIO with Azure shim, a thin
  REST adapter for runtimes without the SDK) by writing a 60-line `BlobOps` of your own.

### Auth modes

Build the underlying `ContainerClient` however you prefer:

```ts
// Connection string
const blobServiceClient = BlobServiceClient.fromConnectionString(connStr);

// Account key
const credential = new StorageSharedKeyCredential('account', 'key');
const blobServiceClient = new BlobServiceClient(
  `https://account.blob.core.windows.net`,
  credential,
);

// Managed identity / DefaultAzureCredential
import { DefaultAzureCredential } from '@azure/identity';
const blobServiceClient = new BlobServiceClient(
  `https://account.blob.core.windows.net`,
  new DefaultAzureCredential(),
);
```

The repository never sees credentials directly — `ContainerClient` owns the auth.

### Behaviour notes

- **Flat container, simulated folders.** Uses `listBlobsByHierarchy('/', {prefix})` for
  direct-children listings. Folder summaries come from the SDK's `BlobPrefix` items; `.keep`
  placeholders are filtered out.
- **Extension hiding.** Same convention as every other `StorageRepository`: keys are extension-free;
  the on-blob name is `<key>.<ext>`.
- **`revisionId`** is the blob's ETag. Not used for optimistic concurrency on update yet — pass it
  back to the underlying SDK via `BlobClient.upload({conditions: {ifMatch: …}})` if you need OCC.
- **Errors.** SDK errors map to Laika: `BlobNotFound`/`ContainerNotFound`/HTTP 404 →
  `NotFoundError`, 401 → `AuthenticationError`, 403 → `ForbiddenError`, 412 →
  `VersionMismatchError`, 429 → `TooManyRequestsError`, 5xx → `ServiceUnavailableError`.
- **Pagination.** `listBlobsByHierarchy` already streams; the repository drains it and applies
  offset/page styles in memory. Cursor pagination is not exposed.

### What this does not do

- No append blobs / page blobs — single-shot `BlockBlobClient.upload` of the serialized body.
- No snapshots or soft-delete handling — those are container-level configurations you set elsewhere.
- No SAS token issuance — bring your own pre-built client.
