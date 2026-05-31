import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config.js';

/**
 * Module-level singleton. Hono runs in a single Node.js process, so this is
 * instantiated once and shared across all requests.
 *
 * Unlike Express, Hono uses the WHATWG Fetch Request/Response natively, so
 * laika.fetch can be wired directly to Hono route handlers without any
 * Node IncomingMessage → Request adapter.
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
