# WebDAV

`WebDavStorageRepository` backs the [Storage protocol](../concepts/storage) with any
[RFC 4918](https://www.rfc-editor.org/rfc/rfc4918) WebDAV server — Nextcloud, ownCloud, Apache
`mod_dav`, `rclone serve webdav`, a Synology NAS, and friends. WebDAV maps almost one-to-one onto
the storage contract: collections are folders, resources are objects, and
`PROPFIND`/`GET`/`PUT`/`DELETE`/`MKCOL` cover every operation.

Runtime-agnostic: the only requirement is a `fetch` implementation.

## Wire it up

```ts
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { WebDavStorageRepository } from 'laikacms/storage-webdav';

const storage = new WebDavStorageRepository(
  {
    baseUrl: 'https://cloud.example.com/remote.php/dav/files/alice',
    basePath: 'laika-content', // optional subfolder under the user's root
    auth: { username: 'alice', password: process.env.NEXTCLOUD_PASS },
  },
  { md: markdownSerializer },
  'md',
);
```

Bearer-token auth works too — `auth: { token: process.env.DAV_TOKEN }` — and `auth.headers` merges
extra headers into every request.

## Capability notes

- If you already run Nextcloud or `rclone serve webdav` in front of something else, you can point
  LaikaCMS at it without standing up a new backend.
- WebDAV verbs like `PROPFIND` sit outside common HTTP client method unions, so this repository uses
  raw `fetch` directly (injectable via its `fetch` config option).
- Full auth and option reference:
  [`storage-webdav` README](https://github.com/laikacms/laikacms/blob/develop/packages/laikacms/src/impl/storage-webdav/README.md).
