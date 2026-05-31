import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config.js';

/**
 * Singleton EmbeddedLaika instance.
 *
 * createEmbeddedLaika wires up:
 *   - FileSystemStorageRepository rooted at contentDir
 *   - Decap config sync (server and editor always agree)
 *   - ContentBaseDocumentsRepository for laika.documents.*
 *   - A fetch handler for the Decap JSON:API + auth endpoints
 *
 * Elysia runs on Bun, which uses WHATWG Request/Response natively.
 * laika.fetch(request) works directly — no Node.js IncomingMessage adapter needed.
 */
export const laika = createEmbeddedLaika({
  contentDir: resolve(import.meta.dir, '..', 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
