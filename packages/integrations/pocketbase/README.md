# `@laikacms/pocketbase`

A [PocketBase](https://pocketbase.io)-backed `StorageRepository` for Laika CMS. The first
**self-hostable open-source** backend in the suite — every other backend is a SaaS endpoint, a
hyperscaler service, or a network protocol. PocketBase is a single binary you run yourself, SQLite
under the hood, REST + JWT on the wire.

Runtime-agnostic — only depends on `fetch`.

## `@laikacms/pocketbase/storage-pb`

```ts
import { PocketBaseStorageRepository } from '@laikacms/pocketbase/storage-pb';
import { storageSerializerMarkdown } from 'laikacms/storage-serializers-markdown';

const repo = new PocketBaseStorageRepository({
  url: 'https://pb.example.com',
  auth: {
    token: process.env.POCKETBASE_TOKEN!, // obtained via /api/admins/auth-with-password
    // or: tokenProvider: () => refreshAuthToken(),
  },
  collectionName: 'laika_storage', // optional — defaults to "laika_storage"
  serializerRegistry: { md: storageSerializerMarkdown },
  defaultFileExtension: 'md',
});
```

### Required collection schema

Provision once via the PocketBase admin UI or `pb migrate`:

| Field       | Type   | Notes                                                    |
| ----------- | ------ | -------------------------------------------------------- |
| `parent`    | TEXT   | parent folder path (empty string for root)               |
| `name`      | TEXT   | basename — includes the extension for files              |
| `path`      | TEXT   | full storage key — **make this an indexed unique field** |
| `type`      | SELECT | values: `file`, `folder`                                 |
| `extension` | TEXT   | files only                                               |
| `content`   | TEXT   | files only, serialized                                   |

The repository never runs DDL or admin endpoints — the collection has to exist before you point the
repository at it.

### How operations map to PocketBase calls

| Operation                    | PocketBase call                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `getObject('hello')`         | one `findOne` — `filter=type="file" && parent="" && (name="hello.md" \|\| name="hello.json" \|\| ...)` |
| `getFolder('notes')`         | one `findOne` — `filter=type="folder" && path="notes"`                                                 |
| `listAtomSummaries('notes')` | one filtered list — `filter=parent="notes"`                                                            |
| `createObject`               | one `POST /records` per file + one per ancestor folder                                                 |
| `updateObject`               | one `PATCH /records/<id>`                                                                              |
| `removeAtoms`                | one `DELETE /records/<id>` per atom                                                                    |

### The filter syntax

PocketBase has its own filter mini-language (`=`, `!=`, `&&`, `||`, parens, double-quoted literals)
— different from GROQ, SQL, Algolia's filter syntax, and every other backend in the suite. The
exported `escapePbFilterValue` helper handles the quoting:

```ts
import { escapePbFilterValue } from '@laikacms/pocketbase/storage-pb';

escapePbFilterValue(`hello "world"`);
// → "hello \"world\""
```

The test suite ships a recursive-descent parser for this mini-language and pins the exact filter
shapes the repository emits — so adding new query patterns to the repository surfaces as parser
failures, not silent regressions.

### Behaviour notes

- **Auto folder chain on deep keys.** `createObject('a/b/c')` walks `a`, `a/b` and writes a folder
  record at each rung that doesn't exist yet. Idempotent — re-creating a folder is a no-op.
- **`metadata.revisionId`** carries the record's `updated` timestamp. Not enforced for OCC by
  PocketBase's PATCH endpoint, so updates are last-writer-wins.
- **JWT tokens are short-lived** by default. Pass an async `tokenProvider` so the repository picks
  up refreshed tokens between calls.
- **Pagination.** `list` drains every page via PocketBase's `page`/`perPage` cursor until
  `page >= totalPages`; then `offset`/`page` styles are applied in memory.

### Errors

| HTTP | Laika error               |
| ---- | ------------------------- |
| 401  | `AuthenticationError`     |
| 403  | `ForbiddenError`          |
| 404  | `NotFoundError`           |
| 429  | `TooManyRequestsError`    |
| 5xx  | `ServiceUnavailableError` |

### What this does not do

- No collection auto-provisioning. Run `pb migrate` or click through the admin UI; the repository
  assumes the collection already exists.
- No PocketBase Files API integration. The repository stores serialized text — for binary assets,
  use the assets contract on a different backend.
- No realtime subscriptions. PocketBase has a great realtime SDK; if you want live updates, layer
  that above this repository.
