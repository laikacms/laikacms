# `@laikacms/dropbox`

Dropbox-backed `StorageRepository` for Laika CMS via the
[Dropbox HTTP API v2](https://www.dropbox.com/developers/documentation/http/documentation).
Runtime-agnostic — only depends on `fetch`. Works on Node, Bun, Deno, Cloudflare Workers, and the
browser.

## `@laikacms/dropbox/storage-dropbox`

```ts
import { DropboxStorageRepository } from '@laikacms/dropbox/storage-dropbox';
import { storageSerializerMarkdown } from 'laikacms/storage-serializers-markdown';

const repo = new DropboxStorageRepository({
  auth: {
    // Either a static token...
    accessToken: process.env.DROPBOX_ACCESS_TOKEN!,
    // ...or an async provider so the repository can pick up refreshes:
    // tokenProvider: () => fetchFreshAccessToken(),
  },
  rootPath: '/laika-content', // optional — scope under a Dropbox subfolder
  serializerRegistry: { md: storageSerializerMarkdown },
  defaultFileExtension: 'md',
});
```

### Why Dropbox here?

It fills the **consumer/business cloud-storage** slot alongside
[`@laikacms/google/storage-drive`](../google), with two meaningful differences:

|                        | Google Drive                                   | Dropbox                                              |
| ---------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| Addressing             | opaque file ids — every read walks a path → id | POSIX paths — `getObject('hello')` is one round-trip |
| Empty folders          | first-class (`mimeType: '…folder'`)            | first-class                                          |
| Name uniqueness        | duplicates allowed — first match wins          | enforced — case-insensitive uniqueness               |
| Upload semantics       | `multipart/related` body                       | raw body + `Dropbox-API-Arg` header                  |
| Optimistic concurrency | not exposed                                    | first-class via `rev` ↔ `metadata.revisionId`        |

The path-based model is a lot less code on this end and removes the "first match wins" caveat
entirely.

### OAuth2 setup (sketch)

1. Create an app in the [Dropbox developer console](https://www.dropbox.com/developers/apps).
2. Pick the **App folder** permission type (or **Full Dropbox** if you really need it). App-folder
   is the safer default — your app only sees its own folder.
3. Request the `files.content.read` and `files.content.write` scopes.
4. Persist the refresh token; mint a fresh access token before each batch of API calls and hand it
   to `tokenProvider`.

### Optimistic concurrency on update

`getObject` returns the file's Dropbox `rev` in `metadata.revisionId`. Pass it back via
`update.metadata.revisionId` on a subsequent `updateObject` to enforce that the file hasn't changed
since you last read it — Dropbox returns a conflict if the rev no longer matches, which surfaces as
a `ConflictError`.

```ts
const obj = await LaikaTask.runPromise(repo.getObject('hello'));
await LaikaTask.runPromise(repo.updateObject({
  key: 'hello',
  content: { body: 'edited' },
  metadata: { revisionId: obj.metadata?.revisionId }, // <-- guards against concurrent edits
}));
```

### Behaviour notes

- **Real folders, no `.keep` placeholders.** Empty folders are first-class.
- **Extension hiding.** Keys are extension-free at the boundary; on-disk file name is `<key>.<ext>`.
- **Permanent deletes.** `removeAtoms` calls `/files/delete_v2`, which **moves to Dropbox trash**
  (recoverable via the Dropbox UI for 30 days on Free plans, 180 on Business). Slightly safer than
  Drive's permanent-delete.
- **Two hostnames.** Metadata calls hit `api.dropboxapi.com`; uploads and downloads hit
  `content.dropboxapi.com`. Both override-able via `apiUrl` / `contentUrl`.
- **Pagination.** `/files/list_folder` is paged through `list_folder/continue` until
  `has_more === false`, then `offset`/`page` styles are applied in memory.
- **Errors.** `path/not_found` → `NotFoundError`; `path/conflict/*` → `ConflictError`; 401 →
  `AuthenticationError`; 403 → `ForbiddenError`; 429 → `TooManyRequestsError`; 5xx →
  `ServiceUnavailableError`.

### What this does not do

- No chunked / resumable uploads. Single-shot `/files/upload` of the serialized body — appropriate
  for content, not large binary assets.
- No share-link generation, no team-folder semantics.
- No Dropbox Paper or other non-file content types.
