# @laikacms/microsoft

[Microsoft Graph](https://learn.microsoft.com/en-us/graph/)-backed implementations of Laika CMS
contracts. First (and current) export: **`@laikacms/microsoft/storage-onedrive`** — a
`StorageRepository` over a OneDrive personal drive, OneDrive for Business, or a SharePoint document
library.

Runtime-agnostic — only depends on `fetch`. Works on Node, Bun, Cloudflare Workers, Deno, and the
browser.

```bash
pnpm add @laikacms/microsoft
```

## Why a Microsoft Graph package

Three architectural traits set OneDrive apart from every other backend in the Laika suite:

**1. Native path addressing.** Drive items live at REST URLs like `/me/drive/root:/notes/hello.md:`
— the colon-segment syntax is unique among the backends. No separate lookup step is needed to map a
Laika key to an opaque object id (S3, etcd, Mongo) or a CMS document id (Sanity, Hygraph). Folder
hierarchy is the real, server-side folder structure of the drive.

**2. `POST /$batch` as the bulk endpoint.** Up to 20 requests in one HTTP round-trip, each with its
own method (GET/POST/PUT/PATCH/DELETE), URL, headers, and body. `removeAtoms(N)` ships as one
`$batch` with N `DELETE` sub-requests; per-sub-request status comes back in a `responses[]` array.
**The 9th structurally distinct atomic-multi-write mechanism in the suite** (atomic-ish — parallel
execution at the HTTP layer, not transactional, but a single HTTP round-trip regardless of N).

**3. Pre-signed `@microsoft.graph.downloadUrl` in metadata.** Every file metadata response carries a
short-lived (1h) public URL that fetches the content with no auth header. The repository exploits
this: `getObject` does _one_ authenticated metadata fetch + one unauthenticated CDN fetch, instead
of two authenticated round-trips.

## Usage

```ts
import {
  OneDriveDataSource,
  OneDriveStorageRepository,
} from '@laikacms/microsoft/storage-onedrive';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const dataSource = new OneDriveDataSource({
  auth: {
    accessToken: process.env.GRAPH_ACCESS_TOKEN!,
    // …or:
    tokenProvider: async () => fetchFreshTokenFromMsal(),
  },
  // Optional — default `/me/drive` (delegated user). For app-only access:
  // drivePath: '/users/{userId}/drive',
  // drivePath: '/drives/{driveId}',
  // drivePath: '/sites/{siteId}/drive',
});

const repo = new OneDriveStorageRepository({
  dataSource,
  basePath: 'cms', // optional subfolder of the drive
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## Operation mapping

| Laika operation             | Microsoft Graph call(s)                                               |
| --------------------------- | --------------------------------------------------------------------- |
| `getObject(key)`            | 1 × `$batch` (N-extension probe) + 1 × CDN GET via downloadUrl        |
| `createObject(key, …)`      | 1 × resolve `$batch` + 1 × `PUT :/content?@…conflictBehavior=fail`    |
| `updateObject(key, …)`      | 1 × resolve `$batch` + 1 × `PUT :/content?@…conflictBehavior=replace` |
| `createOrUpdateObject`      | 1 × resolve `$batch` + 1 × `PUT :/content?@…conflictBehavior=replace` |
| `createFolder(key)`         | 1 × `POST :/children` with `{name, folder: {}}`                       |
| `removeAtoms([k₁…kₙ])`      | n × resolve `$batch` + **1 × `$batch` with N DELETE sub-requests**    |
| `listAtomSummaries(folder)` | 1 × `GET :/children`                                                  |
| `getCapabilities()`         | (no I/O — static)                                                     |

## The `conflictBehavior` choice

OneDrive supports per-write conflict resolution via the `@microsoft.graph.conflictBehavior` URL
query parameter (on `PUT
/content`) or JSON field (on `POST /children`). Three values:

- `fail` — used for `createObject`; surfaces a 409 → `EntryAlreadyExistsError`.
- `replace` — used for `updateObject` / `createOrUpdateObject`.
- `rename` — never used here; OneDrive would auto-pick a non-colliding name.

This is the only backend in the suite with per-write conflict policy configured at the API level
(every other backend either always overwrites, always fails, or wraps OCC in a separate
compare-and-set mechanism).

## Auth

The data source takes a pre-acquired access token. Microsoft Graph auth is OAuth 2.0 / Microsoft
Entra (formerly Azure AD); use MSAL, `@azure/identity`, or the device-code flow to acquire the
token. The `tokenProvider` option supports async refresh:

```ts
import { ConfidentialClientApplication } from '@azure/msal-node';
const msal = new ConfidentialClientApplication({ … });

new OneDriveDataSource({
  auth: {
    tokenProvider: async () => {
      const r = await msal.acquireTokenByClientCredential({
        scopes: ['https://graph.microsoft.com/.default'],
      });
      return r!.accessToken;
    },
  },
});
```

## Caveats

- **`$batch` caps at 20 sub-requests.** The repository chunks `removeAtoms(N)` automatically when N
  > 20.
- **Pre-signed URLs are short-lived (~1h).** Don't cache them at the application layer; refetch
  metadata when you need fresh content.
- **Small-file uploads only.** Files larger than 4MB need OneDrive's upload-session flow, which is
  out of scope for v1.
- **No SharePoint search.** This package only addresses the document library / drive surface.
  Microsoft Graph's `/search/query` endpoint is a future direction.
