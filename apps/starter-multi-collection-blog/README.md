# starter-multi-collection-blog

Portfolio site powered by Hono + LaikaCMS with **three content collections**: blog posts, portfolio
projects, and static pages. Most LaikaCMS starters manage a single `posts` collection; this one
shows how to structure a real multi-type CMS.

## Collections

| Collection | Folder      | Fields                                                 |
| ---------- | ----------- | ------------------------------------------------------ |
| Blog Posts | `posts/`    | title, date, description, body (markdown)              |
| Projects   | `projects/` | title, description, stack (list), url, github          |
| Pages      | `pages/`    | title, body (markdown) — e.g. `about.md`, `contact.md` |

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000> for the portfolio index, <http://localhost:3000/admin> for the CMS.

## Project layout

```
content/
  posts/      ← blog post Markdown files
  projects/   ← portfolio project Markdown files
  pages/      ← static page Markdown files (about, contact, ...)
  config.yml  ← generated from decapConfig at startup
src/
  server.ts   ← Hono server with routes for all three collections
```

## Multi-collection decapConfig

`minimalBlogConfig()` generates a single `posts` collection. For multiple collections, define the
`decapConfig` object directly:

```typescript
const decapConfig = {
  backend: { name: 'laika', api_url: '/api/decap' },
  collections: [
    {
      name: 'posts',
      label: 'Blog Posts',
      folder: 'posts', // ← maps to contentDir/posts/
      create: true,
      fields: [/* ... */],
    },
    {
      name: 'projects',
      label: 'Projects',
      folder: 'projects', // ← maps to contentDir/projects/
      create: true,
      fields: [/* ... */],
    },
  ],
};
```

The `folder` value in each collection maps to a **subdirectory of `contentDir`** AND to the `folder`
parameter of `laika.documents.listRecordSummaries()`:

```typescript
// Reads from contentDir/projects/
const { items } = await collectStream(
  laika.documents.listRecordSummaries({
    folder: 'projects',
    depth: 1,
    type: 'published',
    pagination: { page: 1, perPage: 100 },
  }),
);
```

## Doc gaps surfaced

1. **`minimalBlogConfig()` is a single-collection convenience.** The docs don't prominently show how
   to extend it to multiple collections, or that you simply pass the full `decapConfig` object
   yourself.

2. **`folder` parameter semantics.** `laika.documents.listRecordSummaries({ folder: 'projects' })`
   reads from `contentDir/projects/`. This mapping between Decap's `folder` config and the API
   parameter is not explicitly documented.

3. **Parallel collection queries.** `Promise.all([collectStream(...), collectStream(...)])` works
   fine — LaikaCMS reads are non-blocking and can be parallelised on the homepage for performance.
