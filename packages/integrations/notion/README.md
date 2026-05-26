# `@laikacms/notion`

A Notion-backed `StorageRepository` for Laika CMS. Page hierarchy maps to storage hierarchy: pages
with child pages are **folders**, leaf pages are **objects**, and each leaf page's body (its
non-`child_page` blocks) is the object content.

Runtime-agnostic — only depends on `fetch`. Works on Node, Bun, Deno, Cloudflare Workers, and the
browser. Caller owns OAuth refresh via an optional `tokenProvider`.

## `@laikacms/notion/storage-notion`

```ts
import { NotionStorageRepository } from '@laikacms/notion/storage-notion';

const repo = new NotionStorageRepository({
  auth: {
    accessToken: process.env.NOTION_INTEGRATION_TOKEN!,
    // or: tokenProvider: () => refreshedAccessToken(),
  },
  rootPageId: '1a2b3c4d-5e6f-7890-abcd-ef0123456789',
});
```

### How it maps

| Laika                              | Notion                                                         |
| ---------------------------------- | -------------------------------------------------------------- |
| Root                               | the configured `rootPageId`                                    |
| Folder                             | a page with at least one `child_page` block                    |
| Object                             | a leaf page (no `child_page` children)                         |
| Object content                     | the page's non-`child_page` blocks rendered as plain text      |
| `createFolder('x')`                | creates a page titled `x` under root (empty page)              |
| `createObject('x/y', {body: '…'})` | walks/creates pages `x`, `y`; appends a paragraph block to `y` |
| `removeAtoms(['x'])`               | archives page `x` (Notion's soft delete)                       |

### Trade-offs (read this part)

- **Empty folders aren't visible in listings.** Notion has no "folder marker" — a page with no
  children looks identical to a leaf object. `createFolder('x')` will succeed, but
  `listAtomSummaries('')` will show `x` as an `object-summary` until a child is added. Once you
  `createObject('x/y')`, `x` flips to a `folder-summary`.
- **Plain-text body only.** The repository reads/writes paragraph blocks. Rich-text formatting
  (headings, lists, embeds, databases) is lossy — they're skipped on read and not produced on write.
  Use a Notion-aware adapter layered on top if you need fidelity.
- **No native version counter.** Notion exposes `last_edited_time` as a timestamp but nothing
  monotonic suitable for optimistic concurrency. Updates are last-writer-wins.
- **Replace, not patch.** `updateObject` archives every existing paragraph block then appends one
  fresh paragraph. Atomic enough for single-paragraph storage objects; doesn't preserve
  sub-paragraph diffs.
- **Path → id walking.** Notion addresses by UUID, not path. The repository walks segments
  title-by-title from `rootPageId` and caches the result per repository instance. **Keep one
  instance alive across requests** so the cache pays off.

### Page-summary inference

When listing a folder, the repository asks for `GET /blocks/{folderPageId}/children`. The
`child_page` blocks in that response carry a `has_children` flag — which is what the repository uses
to decide folder-vs-object for each summary, in one round-trip per directory level.

### Auth setup

1. Visit [notion.so/my-integrations](https://www.notion.so/my-integrations) and create an internal
   integration.
2. Copy the **Integration Secret** (starts with `secret_…`).
3. Share the root page (and every page below it that you want this repo to manage) with the
   integration via Notion's "Share" menu — Notion uses page-level ACLs, the token alone isn't
   enough.
4. Pass the token via `auth.accessToken` or refresh it via `auth.tokenProvider`.

### Errors

| HTTP | Laika error               |
| ---- | ------------------------- |
| 401  | `AuthenticationError`     |
| 403  | `ForbiddenError`          |
| 404  | `NotFoundError`           |
| 409  | `ConflictError`           |
| 429  | `TooManyRequestsError`    |
| 5xx  | `ServiceUnavailableError` |
