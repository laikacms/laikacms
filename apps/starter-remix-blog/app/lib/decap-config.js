/**
 * Decap CMS collection config shared between the embedded server (laika.server.ts)
 * and the admin UI (routes/admin.tsx).
 *
 * No .server. suffix — safe to import in both server routes (loaders) and
 * client code (admin page's useEffect). Keep backend, media_folder, and
 * public_folder out of this object — those are injected separately.
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
];
