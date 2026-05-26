# @laikacms/vercel

[Vercel Blob](https://vercel.com/docs/storage/vercel-blob)-backed implementations of Laika CMS
contracts. First (and current) export: **`@laikacms/vercel/storage-blob`** — a `StorageRepository`
over the public Vercel Blob HTTP API.

Runtime-agnostic — only depends on `fetch`. Works on Node, Bun, Cloudflare Workers, Deno, Vercel
Edge, and the browser.

```bash
pnpm add @laikacms/vercel
```

## Why a Vercel Blob package

Vercel Blob is a hosted blob store that sits behind `https://blob.vercel-storage.com`. It looks
superficially like S3, but two API choices make it interesting enough to wrap as its own
implementation:

1. **No native delete-by-pathname.** Deletes go through `POST /delete` with a _URL_ in the body —
   not `DELETE /<key>`. The repository exploits this: `removeAtoms(N)` lands as **one**
   `POST /delete` regardless of N, since the endpoint takes an array of URLs. (Same
   single-round-trip property as Bitbucket's multi-file commit, Sanity's `/mutate`, and Supabase
   PostgREST's `?Path=in.(…)` DELETE — every backend gets there via a structurally different
   mechanism.)

2. **No `delimiter` parameter on list.** Vercel Blob's `?prefix=` listing returns deep-nested
   results, with no `CommonPrefixes`-style subfolder grouping. The repository reconstructs the
   hierarchy client-side by partitioning each path's tail on `/`.

## Usage

```ts
import { VercelBlobDataSource, VercelBlobStorageRepository } from '@laikacms/vercel/storage-blob';
import { jsonSerializer } from 'laikacms/storage-serializers-json';

const dataSource = new VercelBlobDataSource({
  auth: { token: process.env.BLOB_READ_WRITE_TOKEN! },
});

const repo = new VercelBlobStorageRepository({
  dataSource,
  basePath: 'cms', // optional virtual prefix
  serializerRegistry: { json: jsonSerializer },
  defaultFileExtension: 'json',
});

await repo.createObject({ key: 'notes/hello', content: { title: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## Operation mapping

| Laika operation             | Vercel Blob call(s)                                                       |
| --------------------------- | ------------------------------------------------------------------------- |
| `getObject(key)`            | `GET /?prefix=<key>.` → fetch CDN URL                                     |
| `createObject(key, …)`      | `PUT /<key>.<ext>?addRandomSuffix=0`                                      |
| `updateObject(key, …)`      | (single PUT to the resolved pathname)                                     |
| `createOrUpdateObject`      | `GET /?prefix=<key>.` → PUT to existing or new pathname                   |
| `createFolder(key)`         | `PUT /<key>/.keep`                                                        |
| `removeAtoms([k₁…kₙ])`      | n × resolve via `GET /?prefix=…`, then **1** `POST /delete` with all URLs |
| `listAtomSummaries(folder)` | paginate `GET /?prefix=<folder>/&cursor=…` then group client-side         |
| `getCapabilities()`         | (no I/O — static)                                                         |

## The `addRandomSuffix=0` choice

By default `@vercel/blob`'s `put` adds an 8-character random suffix to the pathname (e.g.
`notes/hello.json-xY7q9F2k`). This is great for upload-once content (user uploads, build artefacts),
but breaks Laika's model where the _key_ — not the URL — is the canonical identifier and overwrites
are expected. The data source hard-codes `?addRandomSuffix=0` on every upload so that
`(pathname, extension)` round-trips through the store without surprise.

## Auth

A read-write token is the only configuration:

```ts
new VercelBlobDataSource({
  auth: {
    token: process.env.BLOB_READ_WRITE_TOKEN,
    // ...or async via tokenProvider:
    tokenProvider: async () => fetchTokenFromVault(),
  },
});
```

Provision via the Vercel dashboard → Storage → Blob → "Read-Write Token". The token is passed as
`Authorization: Bearer …` on every API request (but **not** on CDN reads — those run unauthenticated
against the public CDN URL returned by `put`).

## Caveats

- **CDN URLs are effectively the access-control boundary.** Vercel Blob blobs are public to anyone
  with the URL. If you need private blobs, put a Vercel function in front and gate reads there.
- **`listAtoms` over a deep tree pages through every entry.** Vercel Blob's list has no delimiter,
  so `listAtoms('notes')` reads every descendant just to compute the immediate-children view. Same
  big-O cost as the R2 / S3 path, but without the server-side delimiter short-circuit — keep folder
  depth shallow if listing is hot.
- **Empty folders aren't a first-class concept.** `createFolder` drops a `.keep` blob; `getFolder`
  succeeds whenever _any_ descendant exists. This matches the S3 / R2 implementations.
- **No native ETag / If-Match.** Vercel Blob's PUT is last-write-wins. The repository surfaces the
  upload URL as the `revisionId` field, but this is informational only — there's no concurrent-write
  guard.
