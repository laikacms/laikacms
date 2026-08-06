/**
 * Decap CMS collection config shared between the embedded server (index.ts)
 * and the admin UI (adminHtml in index.ts).
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

/** Full Decap config — passed to laika on the server and to CMS.init() in the browser. */
export const decapConfig = {
  backend: { name: 'laika', api_url: '/api/decap' },
  // For production, point media_folder at an R2 bucket (see wrangler.toml [[r2_buckets]]).
  media_folder: 'uploads',
  public_folder: '/uploads',
  collections: blogCollections,
} as const;
