# FileSystem

`FileSystemStorageRepository` stores content as plain files on disk. It is the default backend for
local development, the [Node.js quickstart](../getting-started/nodejs), and any deployment with a
persistent volume — and because content is just files, it composes with git, rsync, and every other
tool you already have.

## Wire it up

```ts
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { jsonSerializer } from 'laikacms/storage-serializers-json';

const storage = new FileSystemStorageRepository(
  './content', // rootDirectory — created automatically on first write
  { json: jsonSerializer }, // serializerRegistry: extension → serializer
  'json', // defaultFileExtension for newly created objects
  // ignoreList?: glob patterns to exclude (optional)
);
```

Keys map to paths under `rootDirectory`: object `posts/hello` with the `json` serializer is the file
`content/posts/hello.json`. Which [serializer](../serializers/) handles a file is picked by its
extension.

## Capability notes

- **Node.js (and Bun) only** — edge runtimes have no filesystem; use [R2](./r2) or [SQL](./sql)
  there, or front a filesystem elsewhere via the [JSON:API proxy](./jsonapi-proxy) and
  [`laika local serve`](../cli/serve).
- In production you need a **persistent volume** at `rootDirectory` so content survives redeploys —
  see [Deploy to Production](../getting-started/deploy).
- `createEmbeddedLaika` (`@laikacms/server/embedded`) wires this backend into a complete Decap
  backend from a single options object.
