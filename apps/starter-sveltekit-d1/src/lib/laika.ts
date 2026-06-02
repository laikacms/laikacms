import { createCustomLaika } from '@laikacms/decap-integrations/custom';

import { makeD1Storage } from './db.js';
import { blogCollections } from './decap-config.js';

/**
 * Per-request Laika factory. Cloudflare D1 bindings are only available
 * inside a request context via event.platform.env — there is no module-level
 * singleton pattern like in Node.js runtimes.
 *
 * This is the key difference between SvelteKit-on-Cloudflare and
 * SvelteKit-on-Node: use makeLaika(platform.env.DB) in every
 * +page.server.ts and +server.ts instead of importing a shared `laika`.
 */
export function makeLaika(db: D1Database) {
  return createCustomLaika({
    storage: makeD1Storage(db),
    decapConfig: {
      backend: { name: 'laika', api_url: '/api/decap' },
      media_folder: 'static/uploads',
      public_folder: '/uploads',
      collections: blogCollections,
    },
    basePath: '/api/decap',
    auth: { mode: 'dev' },
    seedConfigOnFirstRequest: true,
  });
}
