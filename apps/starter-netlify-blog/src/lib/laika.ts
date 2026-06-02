import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config.js';

/**
 * Singleton EmbeddedLaika instance shared across all Netlify Function invocations
 * in the same Node.js process (Netlify reuses processes across requests).
 *
 * createEmbeddedLaika wires up:
 *   - FileSystemStorageRepository rooted at ./content
 *   - Decap config YAML at content/config.yml
 *   - ContentBaseDocumentsRepository + ContentBaseAssetsRepository
 *   - fetch handler for the Decap JSON:API + auth endpoints at basePath
 *
 * Note: Netlify Functions v2 run in Node.js, not the edge runtime.
 * process.cwd() resolves to the project root during local `netlify dev` and
 * in deployed functions (where Netlify sets CWD to the site root).
 */
export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
