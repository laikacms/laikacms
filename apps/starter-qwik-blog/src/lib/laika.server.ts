import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config';

/**
 * Singleton EmbeddedLaika instance for Qwik City.
 *
 * Only import this file in Qwik City route handlers (onRequest, onGet, etc.)
 * or routeLoader$ callbacks — never in component$ functions that run on the
 * client. The .server.ts suffix is a Vite convention that prevents accidental
 * client-side bundling.
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
