import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config.ts';

/**
 * Module-level singleton. Deno runs each module once per process, so this is
 * instantiated once and reused across requests.
 *
 * createEmbeddedLaika uses node:fs and node:path internally.
 * Deno supports both via its built-in Node.js compatibility layer; the
 * deno.json tasks include --allow-read and --allow-write so the fs ops succeed.
 *
 * import.meta.dirname is the directory of THIS file (lib/), so we go up one
 * level to reach the project root and then into content/.
 */
export const laika = createEmbeddedLaika({
  contentDir: resolve(import.meta.dirname ?? Deno.cwd(), '..', 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'static/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
