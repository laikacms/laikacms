import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config.js';

/**
 * Singleton EmbeddedLaika instance.
 *
 * createEmbeddedLaika:
 *   - Roots a FileSystemStorageRepository at `contentDir`
 *   - Writes/reads the Decap config YAML so server and editor always agree
 *   - Wires up ContentBaseDocumentsRepository + ContentBaseAssetsRepository
 *   - Returns a fetch handler for the Decap JSON:API + auth endpoints
 *
 * Import `laika.documents` anywhere in SSR routes to read content without
 * going back through HTTP — use `runTask` / `collectStream` from laikacms/compat.
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
