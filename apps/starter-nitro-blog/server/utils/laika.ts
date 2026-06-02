import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from '../decap-config.js';

/*
 * Doc gap: In Nitro, server/utils/ is auto-imported — anything exported here
 * is available in server/routes/ handlers without an explicit import statement.
 * However, for clarity and IDE support, explicit imports are recommended.
 *
 * This singleton is instantiated once at server startup and reused across
 * all requests, exactly as in Nuxt/SvelteKit/Astro starters.
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
