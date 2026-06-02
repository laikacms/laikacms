import { createCustomLaika } from '@laikacms/decap-integrations/custom';

import { makeD1Storage } from './db.js';
import { blogCollections } from './decap-config.js';

/**
 * Per-request Laika factory.
 *
 * With @astrojs/cloudflare the D1 binding arrives via Astro.locals.runtime.env
 * in .astro pages and via context.locals.runtime.env in API routes. It is not
 * available at module load time, so we cannot use a singleton here.
 *
 * createCustomLaika is synchronous and cheap — no I/O happens until the first
 * laika.fetch() or laika.documents.* call.
 */
export function makeLaika(db: D1Database) {
  return createCustomLaika({
    storage: makeD1Storage(db),
    decapConfig: {
      backend: { name: 'laika', api_url: '/api/decap' },
      media_folder: 'public/uploads',
      public_folder: '/uploads',
      collections: blogCollections,
    },
    basePath: '/api/decap',
    auth: { mode: 'dev' },
    seedConfigOnFirstRequest: true,
  });
}
