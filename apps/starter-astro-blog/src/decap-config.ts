/**
 * Decap CMS collection config shared between the embedded server (laika.ts)
 * and the admin UI (pages/admin/index.astro).
 *
 * Keep backend, media_folder, and public_folder out of this object — those are
 * injected separately for server vs. browser contexts.
 */
export const blogCollections = [
  {
    name: 'posts',
    label: 'Blog Posts',
    folder: 'posts',
    create: true,
    slug: '{{slug}}',
    sortable_fields: ['title', 'date'],
    fields: [
      { label: 'Title', name: 'title', widget: 'string' },
      { label: 'Date', name: 'date', widget: 'datetime' },
      { label: 'Description', name: 'description', widget: 'string', required: false },
      { label: 'Body', name: 'body', widget: 'markdown' },
    ],
  },
] as const;
