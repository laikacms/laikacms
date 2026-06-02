import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config.js';

/**
 * Module-level singleton — Express SSR runs in a single Node.js process so
 * this is instantiated once and reused across all SSR and API requests.
 *
 * Doc gap: `createEmbeddedLaika` resolves `contentDir` relative to `process.cwd()`.
 * In Angular's production build the server entry is compiled into
 * `dist/starter-angular-ssr-blog/server/server.mjs`, so `process.cwd()` is the
 * project root (where you run `node dist/…/server.mjs`) — not the dist folder.
 * Using `resolve(process.cwd(), 'content')` here is correct as long as
 * the server is started from the workspace root / project directory.
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
