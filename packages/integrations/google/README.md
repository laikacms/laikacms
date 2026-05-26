# `@laikacms/google`

Google Cloud service implementations for Laika CMS. Each subpath export is independent — there is no
umbrella entry — so consumers only pull in what they actually use.

Runtime-agnostic: every export depends only on `fetch`. No SDK dependency, no `googleapis` bloat.

## `@laikacms/google/storage-drive`

A `StorageRepository` backed by Google Drive. Each Laika storage object is one Drive file; each
Laika folder is a real Drive folder (`mimeType: 'application/vnd.google-apps.folder'`). The caller
owns the OAuth2 flow and passes either a static access token or an async token-provider callback for
refresh.

```ts
import { GoogleDriveStorageRepository } from '@laikacms/google/storage-drive';
import { storageSerializerMarkdown } from 'laikacms/storage-serializers-markdown';

const repo = new GoogleDriveStorageRepository({
  auth: {
    // Either a static token...
    accessToken: process.env.GOOGLE_ACCESS_TOKEN!,
    // ...or an async provider so the repository can pick up refreshes:
    // tokenProvider: () => fetchFreshAccessToken(),
  },
  // Optional — defaults to the user's "My Drive" root.
  rootFolderId: '1a2b3c-DriveFolderIdForYourApp',
  serializerRegistry: { md: storageSerializerMarkdown },
  defaultFileExtension: 'md',
});
```

### OAuth2 setup (sketch)

1. Create a Google Cloud project and enable the **Google Drive API**.
2. Create an OAuth client ID (Web application) and configure your redirect URI.
3. Request the `drive.file` scope when prompting the user — this limits access to files the app
   itself created, which is the right scope for a CMS workspace. Use `drive` only if you genuinely
   need to read existing user files.
4. Persist the refresh token; mint a fresh access token before each batch of API calls and hand it
   to `tokenProvider`.

### Behaviour notes

- **Real folders, no `.keep` placeholders.** Unlike S3/R2 (flat object stores), Drive supports empty
  folders natively, so `createFolder` writes a real folder and `listAtomSummaries` of an empty
  folder returns `[]` cleanly.
- **Extension hiding.** Keys are extension-free at the boundary; the on-Drive file name is
  `<key>.<ext>` where `<ext>` is picked from the registered serializers (matches every other
  `StorageRepository` in the suite). Files without a registered extension are skipped in listings.
- **Path → id resolution costs round-trips.** Drive addresses files by id, not path; the repository
  walks segments from the root on first lookup and caches the resolved ids in an instance-local map.
  **Keep a `GoogleDriveStorageRepository` instance alive across requests** so subsequent operations
  hit the cache.
- **Name uniqueness.** Drive permits multiple files with the same name in the same folder. This
  repository picks the **first** match. If your editors create duplicates through the Drive UI,
  deduplicate them — the repository will silently prefer one of them.
- **Permanent deletes.** `removeAtoms` calls `DELETE /files/{id}`, which is **permanent** — files do
  not go to Drive trash. Run the repository against a dedicated app folder you control if you want a
  safer blast radius.
- **`revisionId`** is exposed as the file's `version` field (Drive's monotonic per-file counter);
  falls back to `md5Checksum` when `version` isn't returned.
- **`supportsAllDrives` is set on every call**, so shared-drive folder ids work as `rootFolderId`.
- **Pagination.** `files.list` is paged through `nextPageToken` to completion, then `offset`/`page`
  styles are applied in memory. Cursor pagination is not exposed.

### What this does not do

- No resumable uploads. Files are uploaded as a single `multipart/related` request — appropriate for
  content, not for large binary assets.
- No conflict detection on update. Drive's `version` field is exposed as `metadata.revisionId` but
  the repository does not currently round-trip it for optimistic concurrency on `PATCH`.
- No export of Google-native formats (Docs, Sheets, etc.). Those files have synthetic mimeTypes like
  `application/vnd.google-apps.document` and would need a separate "export then translate" path —
  out of scope.
