import { createCustomLaika } from '@laikacms/decap-integrations/custom';

import { blogCollections } from '../../utils/decap-config';
import { makeD1Storage } from './db';

/**
 * Per-request Laika factory.
 *
 * With Nitro's cloudflare-pages preset the D1 binding is available only
 * inside a request via event.context.cloudflare.env.DB — module-level
 * singletons do not work. createCustomLaika is synchronous and cheap.
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
