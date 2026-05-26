# @laikacms/backblaze

[Backblaze B2](https://www.backblaze.com/cloud-storage)-backed implementations of Laika CMS
contracts using the **native B2 API** (not the S3-compatible mode). First (and current) export:
**`@laikacms/backblaze/storage-b2`** — a `StorageRepository` over the B2 native API.

Runtime-agnostic — only depends on `fetch` and Web Crypto (for SHA-1).

```bash
pnpm add @laikacms/backblaze
```

> **Why native, not S3-compatible?** Backblaze offers an S3-compatible endpoint that works with
> `@laikacms/aws/storage-s3`. This package exposes the _native_ API instead, whose wire conventions
> are structurally distinct from S3 — five traits that fundamentally differ. If you don't need those
> traits, use the S3 adapter.

## Why a native-B2 package

The native API has five wire-format choices that set it apart from every prior backend in the Laika
suite:

**1. Two-phase upload pattern.** Every upload requires a separate `b2_get_upload_url` call first,
which returns a fresh `uploadUrl` + `uploadAuthorizationToken` pair. The subsequent `b2_upload_file`
POSTs to _that_ URL with _that_ token — a different endpoint and a different token from the
account-level API:

```
1. POST <api>/b2api/v3/b2_get_upload_url  →  { uploadUrl, authorizationToken }
2. POST <uploadUrl>                       →  (with the per-upload token)
```

**First backend in the suite with this auth pattern.** The data source caches upload URLs (~23h
lifetime) and re-acquires on 503.

**2. File versioning by default.** Every upload creates a new version of the file; deletes need the
`(fileName, fileId)` tuple, not just the name. Distinct from S3-style overwrite-in-place — old
versions linger until explicitly deleted (or pruned by a lifecycle policy).

**3. Mandatory SHA-1 content verification.** Uploads MUST include an `X-Bz-Content-Sha1` header
matching the actual content. Backblaze rejects mismatches at the storage layer. **First backend in
the suite with mandatory content-hash verification on writes.** The data source computes SHA-1 via
Web Crypto before every upload (`computeSha1Hex`, exported for app code).

**4. Bare `Authorization: <token>` header.** No `Bearer`, no `Token`, no `Basic` — just the token.
**Distinct from every other auth header convention in the suite.** Account-level calls use the
account token; uploads use the per-upload token.

**5. POST-for-everything API.** Even reads of _metadata_ use POST with a JSON body —
`POST /b2_list_file_names` body `{bucketId, prefix}`. Downloads of content are the only GET
endpoint. **First backend with this convention** — every other backend uses GET for reads.

## Usage

```ts
import { B2DataSource, B2StorageRepository } from '@laikacms/backblaze/storage-b2';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const dataSource = new B2DataSource({
  auth: {
    keyId: process.env.B2_KEY_ID!,
    applicationKey: process.env.B2_APPLICATION_KEY!,
  },
  bucketId: 'your-bucket-id',
  bucketName: 'your-bucket-name',
});

const repo = new B2StorageRepository({
  dataSource,
  basePath: 'cms', // optional subfolder of the bucket
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## Operation mapping

| Laika operation             | Backblaze B2 native call(s)                                                  |
| --------------------------- | ---------------------------------------------------------------------------- |
| `getObject(key)`            | 1 × `b2_list_file_names` (extension probe) + 1 × `GET /file/{bucket}/{name}` |
| `createObject(key, …)`      | 1 × probe + 1 × `b2_get_upload_url` + 1 × `POST <uploadUrl>`                 |
| `updateObject(key, …)`      | 1 × probe + 1 × upload (new version)                                         |
| `createOrUpdateObject`      | 1 × probe + 1 × upload                                                       |
| `createFolder(key)`         | 1 × upload `.keep` placeholder                                               |
| `removeAtoms([k₁…kₙ])`      | n × probe + **n × parallel `b2_delete_file_version`** (no bulk endpoint)     |
| `listAtomSummaries(folder)` | 1 × `b2_list_file_names` with `delimiter='/'`                                |
| `getCapabilities()`         | (no I/O — static)                                                            |

`b2_authorize_account` runs once on the first call; the account token is cached for the data
source's lifetime. Upload URLs are cached for ~23h and refreshed automatically on 503 errors.

## What this iteration does NOT add

`removeAtoms(N)` does N parallel `b2_delete_file_version` calls — Backblaze B2 has no bulk-delete
endpoint. **Not a new atomic-multi-write mechanism**, same honest framing as Solid Pod, ClickHouse,
Trello, Convex, InfluxDB.

## Auth

Provision an application key in the Backblaze B2 dashboard. Both `keyId` and `applicationKey` are
visible exactly once at creation time — store them in your secret manager.

```ts
new B2DataSource({
  auth: {
    keyId: process.env.B2_KEY_ID!,
    applicationKey: process.env.B2_APPLICATION_KEY!,
  },
  bucketId,
  bucketName,
});
```

The application key needs **listFiles**, **readFiles**, **writeFiles**, **deleteFiles** capabilities
for the bucket.

## Caveats

- **Versioning piles up.** Every update creates a new version. Old versions cost storage until
  explicitly deleted or pruned by a B2 lifecycle rule. The repository doesn't clean up old versions
  — only the user-issued `removeAtoms` does, and it removes only the _latest_ version. To remove ALL
  versions of a file, you'd need to call `listFileVersions` + delete each — out of scope for v1.
- **SHA-1 hash collisions exist (theoretically).** Backblaze's SHA-1 verification is intended for
  integrity (catching transmission errors), not cryptographic resistance. For cryptographically-
  protected content, layer encryption + an additional MAC on top.
- **Upload-URL caching.** The data source assumes a ~23h lifetime for upload URLs and refreshes
  on 503. If your workload has long idle periods + frequent retries, consider invalidating the cache
  manually via `dataSource.invalidateAccountAuth()`.
- **Account-token expiry.** The account `authorizationToken` from `b2_authorize_account` lasts about
  24h. The data source doesn't auto-refresh on 401 — manually invalidate via
  `dataSource.invalidateAccountAuth()` when you detect a stale token.
- **Bucket name vs bucket ID.** Many B2 operations use `bucketId` (a 10-char internal id like
  `bkt_a1b2c3`); downloads use `bucketName` (the human-readable name). Both must be configured.
