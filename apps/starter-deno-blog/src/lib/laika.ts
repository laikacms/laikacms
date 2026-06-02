import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config.ts';

/**
 * Singleton EmbeddedLaika instance.
 *
 * createEmbeddedLaika uses node:fs and node:path internally.
 * Deno supports both via its Node.js compatibility layer.
 * Required Deno permissions: --allow-read --allow-write (for content/).
 *
 * Using import.meta.dirname (supported in Deno 1.28+ and Node 21.2+)
 * rather than Deno.cwd() so the path is correct regardless of where
 * the process is started.
 */
export const laika = createEmbeddedLaika({
  contentDir: resolve(import.meta.dirname!, '..', '..', 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
