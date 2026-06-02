/**
 * Browser-side admin bundle entry point.
 *
 * Bundled by esbuild (pnpm build:admin):
 *   server/admin-client.ts → public/admin/bundle.js
 */
import createLaikaBackend from '@laikacms/decap-integrations/decap-cms-backend-laika';

import { blogCollections } from './decap-config.js';

declare const window: Window & {
  CMS: {
    registerBackend: (name: string, backend: unknown) => void,
    init: (options: unknown) => void,
  },
};

window.CMS.registerBackend('laika', createLaikaBackend());

window.CMS.init({
  config: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
