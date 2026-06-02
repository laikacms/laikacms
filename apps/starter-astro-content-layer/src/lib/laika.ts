import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

// The same laika instance is used by both:
//   1. The content loader (build time / dev server) — reads posts into Astro's store
//   2. The SSR admin routes — serves the Decap JSON:API at runtime
//
// Because contentDir is the same filesystem path in both contexts, they
// naturally share content: the CMS writes markdown, the loader reads it.
export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: [
      {
        name: 'posts',
        label: 'Blog Posts',
        folder: 'posts',
        create: true,
        slug: '{{slug}}',
        fields: [
          { label: 'Title', name: 'title', widget: 'string' },
          { label: 'Date', name: 'date', widget: 'datetime' },
          { label: 'Description', name: 'description', widget: 'string', required: false },
          { label: 'Body', name: 'body', widget: 'markdown' },
        ],
      },
    ],
  },
});
