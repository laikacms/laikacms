# starter-preview-mode

Starter blog showing **content preview / draft mode** with [LaikaCMS](https://laikacms.dev). Uses
`laika.documents.getUnpublished()` to render draft posts before they are published.

## What this demonstrates

- **`getUnpublished(key)`** — retrieves a draft or pending-review post that hasn't been published
  yet. Complements `getDocument(key)` which only returns published content.
- **`listRecordSummaries({ type: 'unpublished' })`** — lists draft posts. Compared to
  `type: 'published'` (used in every other starter), the `'unpublished'` type returns documents in
  any non-published status: `draft`, `pending_review`, `pending_publish`, `archived`, `trash`.
- **Preview token** — a shared secret in `PREVIEW_TOKEN` controls access to the draft list and
  preview pages. Simple to extend to per-user tokens or JWTs.
- **Status badge** — the preview page shows `doc.status` so editors know where the post is in the
  workflow (`draft`, `pending_review`, etc.).

## Getting started

```bash
cd apps/starter-preview-mode
pnpm install

# Optional
export PREVIEW_TOKEN=my-secret-preview-token

pnpm dev
```

| URL                                           | What                                |
| --------------------------------------------- | ----------------------------------- |
| `http://localhost:3000/`                      | Public blog (published posts only)  |
| `http://localhost:3000/admin`                 | Decap CMS (create / edit posts)     |
| `http://localhost:3000/drafts?token=…`        | Draft list (preview token required) |
| `http://localhost:3000/preview/:slug?token=…` | Preview a specific draft            |

Create a post in the CMS, **save without publishing** (set status to Draft), then visit the
`/drafts` list to preview it.

## The two content APIs

```ts
// Published post — available to all visitors
const doc = await runTask(laika.documents.getDocument('posts/my-slug'));
// doc.type === 'published'
// doc.status === 'published'

// Draft post — only renderable server-side via a trusted preview token
const draft = await runTask(laika.documents.getUnpublished('posts/my-slug'));
// draft.type === 'unpublished'
// draft.status === 'draft' | 'pending_review' | 'pending_publish' | 'archived' | 'trash'
```

## Listing documents by status

```ts
// Published only
const { items } = await collectStream(
  laika.documents.listRecordSummaries({
    pagination: { page: 1, perPage: 100 },
    folder: 'posts',
    depth: 1,
    type: 'published',
  }),
);

// Unpublished / drafts only
const { items: drafts } = await collectStream(
  laika.documents.listRecordSummaries({
    pagination: { page: 1, perPage: 100 },
    folder: 'posts',
    depth: 1,
    type: 'unpublished', // 'published' | 'unpublished' | undefined (all)
  }),
);

// All documents (published + unpublished)
const { items: all } = await collectStream(
  laika.documents.listRecordSummaries({
    pagination: { page: 1, perPage: 100 },
    folder: 'posts',
    depth: 1,
    // type: undefined — returns both
  }),
);
```

## Production notes

- Replace the shared `PREVIEW_TOKEN` with per-user signed preview URLs (e.g., a JWT with
  `{ slug, exp }` signed by your private key).
- The `getUnpublished()` path bypasses the auth layer — only call it after verifying the preview
  token on your server. Never expose draft content without authentication.
- Combine with `starter-session-auth` to gate the entire admin and preview behind a login.

## Project structure

```
apps/starter-preview-mode/
├── src/
│   └── server.ts      # Hono server — public blog, draft list, preview endpoint
├── content/
│   └── posts/         # Markdown posts managed by LaikaCMS
├── package.json
├── tsconfig.json
└── README.md
```
