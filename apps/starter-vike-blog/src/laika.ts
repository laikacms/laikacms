import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config.js';

/**
 * Singleton EmbeddedLaika instance — imported only in server-side code
 * (server/index.ts and pages/[route]/+data.ts files, which run server-side only).
 *
 * Vike's +data.ts files run exclusively on the server; the data they return
 * is serialised to JSON and sent to the client. Importing laika here is safe
 * because Vike never bundles `+data.ts` files into the client bundle.
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
