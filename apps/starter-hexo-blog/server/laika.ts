import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Hexo stores posts in source/_posts/. By setting contentDir to source/ and
// folder to '_posts', Decap maps the posts collection to the correct directory.
export const decapConfig = {
  backend: { name: 'laika', api_url: '/api/decap', branch: 'main' },
  // Hexo serves static assets from the public/ build output, but media uploaded
  // via Decap lands in source/uploads/ (copied to public/uploads/ on build).
  media_folder: 'source/uploads',
  public_folder: '/uploads',
  collections: [
    {
      name: 'posts',
      label: 'Posts',
      folder: '_posts',
      create: true,
      slug: '{{slug}}',
      extension: 'md',
      fields: [
        { name: 'title', label: 'Title', widget: 'string' },
        { name: 'date', label: 'Date', widget: 'datetime' },
        { name: 'tags', label: 'Tags', widget: 'list', required: false },
        { name: 'categories', label: 'Categories', widget: 'list', required: false },
        { name: 'body', label: 'Body', widget: 'markdown' },
      ],
    },
  ],
};

export const laika = createEmbeddedLaika({
  contentDir: resolve(__dirname, '..', 'source'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig,
});
