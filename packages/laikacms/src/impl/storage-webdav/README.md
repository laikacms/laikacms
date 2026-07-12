# `laikacms/storage/webdav`

A `StorageRepository` implementation backed by any
[RFC 4918](https://www.rfc-editor.org/rfc/rfc4918) WebDAV server — Nextcloud, ownCloud, Apache
`mod_dav`, `rclone serve webdav`, [`hacdias/webdav`](https://github.com/hacdias/webdav), and
friends. Runtime-agnostic: the only requirement is a `fetch` implementation, so it runs on Node,
Bun, Deno, Cloudflare Workers, and the browser.

## Why WebDAV?

WebDAV maps almost one-to-one onto Laika's storage contract: collections are folders, resources are
objects, and `PROPFIND`/`GET`/`PUT`/`DELETE`/`MKCOL` cover every operation. If you already host a
Nextcloud instance, a Synology NAS, or `rclone serve webdav` in front of S3, you can point Laika at
it without standing up a new backend.

## Usage

```ts
import { markdownSerializer } from 'laikacms/serializers/markdown';
import { WebDavStorageRepository } from 'laikacms/storage/webdav';

const repo = new WebDavStorageRepository(
  {
    baseUrl: 'https://cloud.example.com/remote.php/dav/files/alice',
    basePath: 'laika-content', // optional subfolder under the user's root
    auth: { username: 'alice', password: process.env.NEXTCLOUD_PASS },
  },
  { md: markdownSerializer },
  'md',
);

const stream = repo.listAtomSummaries('', { depth: 1, pagination: { offset: 0, limit: 50 } });
```

### Bearer-token auth

```ts
new WebDavStorageRepository(
  {
    baseUrl: 'https://dav.example.com',
    auth: { token: process.env.DAV_TOKEN },
  },
  serializers,
  'json',
);
```

### Extra request headers (`auth.headers`)

`auth.headers` is a plain object of header name → value pairs merged into every request alongside
the standard auth credentials. Use it for server-specific requirements such as Nextcloud's
`OCS-APIRequest` header:

```ts
// Nextcloud: add OCS-APIRequest header alongside basic auth
new WebDavStorageRepository(
  {
    baseUrl: 'https://cloud.example.com',
    basePath: '/remote.php/dav/files/alice/',
    auth: {
      username: 'alice',
      password: 'secret',
      headers: { 'OCS-APIRequest': 'true' },
    },
  },
  { md: markdownSerializer },
  'md',
);
```

`auth.headers` can be combined with any auth style (basic, bearer, or anonymous). The extra headers
are applied first; the `Authorization` header is always appended after them, so you cannot
accidentally override credentials via `auth.headers`.

### Custom `fetch`

Pass `fetch` for non-standard runtimes or to inject a test double:

```ts
new WebDavStorageRepository(
  { baseUrl: '...', fetch: myInstrumentedFetch },
  serializers,
  'json',
);
```

### Custom extension policy

The optional 4th argument overrides how the on-server file extension is chosen when writing a new
object. The default behaviour is `metadata.extension ?? defaultFileExtension`.

```ts
import { markdownSerializer } from 'laikacms/serializers/markdown';
import { yamlSerializer } from 'laikacms/serializers/yaml';
import { WebDavStorageRepository } from 'laikacms/storage/webdav';

// Always store as .yaml regardless of metadata.extension or defaultFileExtension.
new WebDavStorageRepository(
  {
    baseUrl: 'https://cloud.example.com/remote.php/dav/files/alice',
    basePath: 'laika-content',
    auth: { username: 'alice', password: process.env.NEXTCLOUD_PASS },
  },
  { md: markdownSerializer, yaml: yamlSerializer },
  'md',
  (_key, { metadata, defaultExtension }) => metadata?.extension ?? 'yaml',
);
```

The callback receives the object `key` and a context object with:

- `metadata` — optional metadata from the create/update call (may contain an `extension` hint)
- `defaultExtension` — the storage's configured `defaultFileExtension`

Returning `undefined` falls back to `defaultFileExtension`. Returning a non-`undefined` string that
has no registered serializer causes `createObject` / `createOrUpdateObject` to fail immediately with
a `BadRequestError` listing the available extensions — the object is not written.

## Behaviour notes

- **Extension hiding.** Keys are extension-free at the boundary, exactly like `storage-fs`. The
  on-server file extension is chosen via `determineExtension` (default:
  `metadata.extension ?? defaultFileExtension`) and looked up on read by probing each registered
  serializer extension.
- **Parent collections.** `PUT` and `createFolder` issue `MKCOL` top-down so deeply nested writes
  succeed against servers that require parents to exist (most of them).
- **Safe deletes.** `removeAtoms` refuses to delete a non-empty collection — even though WebDAV
  `DELETE` on a collection is recursive — so an accidental folder delete cannot wipe nested content.
  The refusal is surfaced as a stream warning, not a fatal error.
- **Pagination.** Cursor pagination is not supported (WebDAV `PROPFIND` returns the full listing);
  offset and page styles are emulated in memory after a natural-order sort.
- **Listings on missing folders** are reported as `recoverableErrors` (a `NotFoundError`), matching
  every other `StorageRepository` implementation.

## What this does not do

- No `LOCK`/`UNLOCK`. Concurrent writers will race; if your server enforces locking you'll see
  `423 Locked` come back as a `ConflictError`.
- No multipart/chunked upload — objects are written with a single `PUT` of the serialized body. Use
  a different repository if you store very large blobs.
- No streaming reads. `GET` bodies are buffered into memory before deserialization. Suitable for
  documents, not for large binary assets — use the assets API for those.

## Compatibility

Tested against the parser fixtures Nextcloud, Apache `mod_dav`, and `rclone serve webdav` produce.
The XML parser is namespace-agnostic, so servers that emit `D:`, `d:`, or no prefix at all all work.
