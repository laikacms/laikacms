# `@laikacms/gist`

A GitHub Gist-backed `StorageRepository` for Laika CMS. Every storage operation — create, update,
delete, batch delete — goes through GitHub's single `PATCH /gists/{id}` endpoint with the full file
delta in one request. Closer in shape to Bitbucket's unified `POST /src` (iter 14) and Sanity's
`/mutate` (iter 17) than to GitHub's per-file Contents API (`@laikacms/github`).

Runtime-agnostic — only depends on `fetch`.

## `@laikacms/gist/storage-gist`

```ts
import { GistStorageRepository } from '@laikacms/gist/storage-gist';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const repo = new GistStorageRepository({
  gistId: 'abc123...', // existing gist; caller creates it
  auth: { token: process.env.GITHUB_PAT! }, // PAT with `gist` scope
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});
```

### The quirk — atomic multi-file PATCH

GitHub's Gist API has exactly **two** endpoints the repository touches: `GET /gists/{id}` and
`PATCH /gists/{id}`. The PATCH body is the full file-delta map:

```ts
{ files: {
    "hello.md":     { content: "new content" },     // create or update
    "goodbye.md":   null,                           // delete
    "notes__a.md":  { content: "atomically with the rest" },
}}
```

Multiple changes in one PATCH commit as a single revision in the gist's history. **`removeAtoms`
exploits this**: deleting `['a', 'b', 'c']` resolves all three to filenames first, then ships one
PATCH with three `null` values. The "uses one atomic commit" test counts the PATCH calls explicitly
— `removeAtoms` over N keys does **one** PATCH, not N.

### The filename quirk — `/` is forbidden

GitHub disallows `/` in gist filenames. The data source encodes `/` → `__` on the way to the wire
and decodes it back on read:

```
storage key       on-gist filename
hello             hello.md
notes/hello       notes__hello.md
a/b/c             a__b__c.md
```

Keys that literally contain `__` are rejected upfront with `BadRequestError` so the encoding stays
unambiguous. `encodeGistFilename` and `decodeGistFilename` are exported for callers who need to work
with the raw filenames.

### Folders

Folders are simulated via the `/` → `__` encoding plus the existing `.keep` placeholder convention
from `storage-s3` / `storage-r2`. Listing a folder pages through the gist's full file map once and
partitions on the first `__` after the configured prefix.

### Operation cost

| Operation                                              | Round-trips                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `getObject`, `getFolder`, `listAtomSummaries`          | one `GET /gists/{id}`                                         |
| `createObject`, `updateObject`, `createOrUpdateObject` | one `GET` (probe / find-by-extension) + one `PATCH`           |
| `removeAtoms(keys)`                                    | one `GET` (resolve every key) + one `PATCH` (delete them all) |
| `createFolder`                                         | one `PATCH` (writes a `.keep`)                                |

`getObject` may issue a follow-up GET to `raw_url` when GitHub truncates a file in the listing
response (large files only).

### Trade-offs

- **Single-gist scope.** One gist is the unit. Gists are bounded at ~300 files and ~1MB total — for
  larger stores instantiate multiple repositories against multiple gists, or pick a different
  backend.
- **No OCC.** Gist's PATCH endpoint accepts no `If-Match`. Updates are last-writer-wins.
- **Public vs secret.** The repository doesn't change the gist's visibility. Public gists are
  world-readable; secret gists are obscure but not access-controlled. Treat both as roughly public.
- **`metadata.revisionId`** is the latest entry in `history` (the commit-style version id GitHub
  maintains). Observability only — not enforced on write.

### Errors

| HTTP | Laika error               |
| ---- | ------------------------- |
| 401  | `AuthenticationError`     |
| 403  | `ForbiddenError`          |
| 404  | `NotFoundError`           |
| 429  | `TooManyRequestsError`    |
| 5xx  | `ServiceUnavailableError` |

### What this is good for

- Personal CMS / scratch notes — the lowest-friction backend in the suite. Sign in with a GitHub
  PAT, create one gist, point Laika at it. Done.
- Anonymous-able snippets stores — give somebody a secret gist URL and they can read it.
- Demo / fixture data — the gist is human-editable through GitHub's UI; pair that with this
  repository for round-trip-safe scripted fixtures.
