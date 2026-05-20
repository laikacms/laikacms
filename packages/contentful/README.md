# `@laikacms/contentful`

Contentful-backed `StorageRepository` for Laika CMS via the [Content Management API](https://www.contentful.com/developers/docs/references/content-management-api/). Runtime-agnostic — only depends on `fetch`. Works on Node, Bun, Deno, Cloudflare Workers, and the browser.

## `@laikacms/contentful/storage-contentful`

```ts
import { ContentfulStorageRepository } from '@laikacms/contentful/storage-contentful';

const repo = new ContentfulStorageRepository({
  spaceId: process.env.CONTENTFUL_SPACE_ID!,
  environmentId: 'master',                       // optional — defaults to 'master'
  defaultLocale: 'en-US',                        // optional — defaults to 'en-US'
  auth: {
    accessToken: process.env.CONTENTFUL_CMA_TOKEN!,
    // or: tokenProvider: () => refreshedToken(),
  },
});
```

### Why a separate kind of `StorageRepository`?

Every other backend in the suite serializes content to a string before writing — Contentful is the odd one out because the wire format is structured fields, not blobs. The mapping is two levels deep, no more:

```
<contentTypeId>/<entryId>     a Contentful entry — an "object"
<contentTypeId>               a Contentful content type — a "folder"
<root>                        the environment — implicitly a folder of folders
```

There's no extension hiding, no serializer step, no `.keep` placeholders. Object content is the entry's `fields` flattened to the configured `defaultLocale`; writes wrap each value back under that locale before sending.

### Native optimistic concurrency

Contentful's `sys.version` counter is real OCC. `getObject` returns it as `metadata.revisionId`; pass it back on `updateObject` and Contentful returns a `409 VersionMismatch` (mapped to `VersionMismatchError`) if anything else has touched the entry in the meantime:

```ts
const post = await LaikaTask.runPromise(repo.getObject('blog/hello'));
await LaikaTask.runPromise(repo.updateObject({
  key: 'blog/hello',
  content: { body: 'edited' },
  metadata: { revisionId: post.metadata?.revisionId },  // <-- enforce no concurrent edits
}));
```

If you omit `revisionId`, the repository falls back to last-writer-wins from your client's perspective (it fetches the current version under the hood, then writes).

### Two-segment key constraint

Storage keys deeper than two segments are rejected with `BadRequestError`. Contentful's data model has no nested entries — anything that would require `getObject('blog/a/b')` doesn't exist on Contentful's side.

### `createFolder` activates a content type

`createFolder('blog')` is idempotent: it creates a Contentful content type with id `blog` (default schema: a single `body: Text` field) and activates it. If a content type with that id already exists, it's a no-op that returns the existing metadata. Override the default schema by hand-managing your content types in the Contentful UI — the repository never edits an existing schema's fields.

### Multi-segment / deep semantics

| Operation | Behaviour |
|---|---|
| `listAtomSummaries('')` | every content type as a folder-summary |
| `listAtomSummaries('blog')` | every entry of `blog` as an object-summary |
| `listAtomSummaries('blog/x')` | recoverable `NotFoundError` — not a valid folder key |
| `createObject({key: 'blog/x', ...})` | create entry `x` under content type `blog` |
| `createOrUpdateObject` | also auto-creates the content type via `ensureContentType` |
| `removeAtoms(['blog/x'])` | delete entry `x` (OCC-checked) |
| `removeAtoms(['blog'])` | **refused** — admin op, do it via the Contentful UI |

### Trade-offs

- **Two locale paths.** Reads prefer `defaultLocale` and fall back to the first available locale to avoid dropping content silently. Writes always emit values under `defaultLocale`. If you need to write multi-locale content, layer that above this repository.
- **No publish lifecycle.** Entries are created/updated in draft state; publishing is a separate Contentful concept that doesn't map onto the storage contract. Use `documents-contentbase` for the published/unpublished split, or call the CMA directly.
- **Validation is upstream.** Contentful's schemas reject writes that don't match — those surface as `InvalidData` (HTTP 422). Field types/validations are configured in Contentful, not here.

### Errors

| HTTP | Laika error |
|---|---|
| 401 | `AuthenticationError` |
| 403 | `ForbiddenError` |
| 404 | `NotFoundError` |
| 409 | `VersionMismatchError` |
| 422 | `InvalidData` |
| 429 | `TooManyRequestsError` |
| 5xx | `ServiceUnavailableError` |
