/**
 * Decap CMS collection config — shared between the dev server middleware
 * (eleventy.config.mjs → laika.js) and the admin UI (admin-client.ts).
 *
 * Plain ESM so Eleventy can import it without a TypeScript loader.
 * If you want TypeScript here, run Eleventy with `node --import tsx/esm`.
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
