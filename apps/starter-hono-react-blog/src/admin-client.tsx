/**
 * Browser-side admin bundle entry point.
 *
 * Bundled by esbuild (pnpm build:admin):
 *   src/admin-client.tsx → public/admin/bundle.js
 *
 * Pattern: "Decap admin from CDN"
 *   1. public/admin/index.html sets window.CMS_MANUAL_INIT = true
 *   2. CDN script (synchronous) sets window.CMS
 *   3. This module (type="module", deferred) registers the laika backend
 *      and calls CMS.init()
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
