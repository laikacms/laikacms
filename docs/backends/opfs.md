# Browser File System (OPFS)

`WebFsStorageRepository` backs the [Storage protocol](../concepts/storage) with the browser's File
System API — any `FileSystemDirectoryHandle`: the origin-private file system (OPFS, the default), a
user-picked `showDirectoryPicker()` directory (Chromium then reads and writes real on-disk files),
or an injected shim. LaikaCMS content can be read **and written** entirely in the browser, no server
involved.

## Wire it up

```ts
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { WebFsStorageRepository } from 'laikacms/storage-web-fs';

const repo = new WebFsStorageRepository({
  root: await navigator.storage.getDirectory(), // optional — this is the default, resolved lazily
  serializerRegistry: { json: jsonSerializer },
  defaultExtension: 'json',
});
```

With a user-picked directory instead (writes go straight to the user's disk in Chromium):

```ts
const repo = new WebFsStorageRepository({
  root: await showDirectoryPicker({ mode: 'readwrite' }),
  serializerRegistry: { json: jsonSerializer },
  defaultExtension: 'json',
});
```

`root` also accepts a provider function — sync or async — for applications that persist handles.

## Capability notes

- The repository deliberately does not care where a handle came from: permissions and liveness are
  (re-)validated **on every operation**, failing with typed, actionable errors when a permission was
  revoked or a handle went stale.
- Real hierarchy (empty folders exist without `.keep` markers) and far higher quota than
  [Web Storage](./web) — typically a large fraction of available disk for OPFS roots.
- **Not a secret store**, and origin-private roots are invisible to the user's real file system.
- [`starter-opfs-blog`](../getting-started/starters) runs a complete local-first blog — Decap admin
  included — on this backend.
