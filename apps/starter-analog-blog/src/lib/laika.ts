import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config.js';

/**
 * Singleton EmbeddedLaika instance.
 *
 * Only imported in server contexts:
 *   - src/server/routes/api/decap/[...path].ts  (Nitro API route)
 *   - page `load` functions (Analog extracts these for the server bundle)
 *
 * Analog's Vite plugin ensures `load` function bodies and their imports are
 * excluded from the client bundle — see the pages for usage examples.
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
