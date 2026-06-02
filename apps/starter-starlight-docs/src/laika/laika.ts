import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { docsCollections } from './decap-config.js';

/**
 * contentDir = src/content so the Decap collection folder:"docs" maps to
 * src/content/docs/ — the exact path Starlight reads its pages from.
 *
 * LaikaCMS stores its own config.yml at src/content/config.yml, which Astro
 * ignores (it only processes src/content.config.ts for collection definitions).
 */
export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'src/content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: docsCollections,
  },
});
