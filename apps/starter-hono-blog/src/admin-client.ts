/**
 * Browser-side admin bundle entry point.
 *
 * Bundled by esbuild (pnpm build:admin):
 *   src/admin-client.ts → public/admin/bundle.js
 *
 * Pattern: "Decap admin from CDN"
 *   1. public/admin/index.html sets window.CMS_MANUAL_INIT = true inline
 *      before the CDN script loads, preventing auto-init.
 *   2. The CDN script (loaded synchronously) sets CMS.
 *   3. This module script (type="module", always deferred) runs after the
 *      CDN script, registers the laika backend, then calls CMS.init().
 */
import createLaikaBackend from '@laikacms/decap-integrations/decap-cms-backend-laika';
import _CMS from 'decap-cms-app';

import { blogCollections } from './decap-config.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CMS = _CMS as any; // LCMS-064: decap-cms-app types are stricter than runtime allows

CMS.registerBackend('laika', createLaikaBackend());

CMS.init({
  config: {
    backend: { name: 'laika', api_root: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
