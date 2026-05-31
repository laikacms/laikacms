import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config.js';

/**
 * Lambda uses Node.js with access to the filesystem, so createEmbeddedLaika
 * works exactly as in other Node.js starters (Astro, Next, Hono, Express).
 *
 * Lambda's writable filesystem is at /tmp (512 MB by default).  The content
 * directory is set to /tmp/laika-content so it persists within a warm execution
 * environment between invocations.
 *
 * Note: /tmp is NOT shared between concurrent Lambda instances.  For production
 * use a persistent store (e.g. S3-backed storage) instead of the filesystem.
 * The filesystem approach is fine for demos and single-instance deployments.
 */
export const laika = createEmbeddedLaika({
  contentDir: resolve('/tmp', 'laika-content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
