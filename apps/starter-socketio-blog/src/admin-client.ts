/**
 * Browser-side admin bundle entry point.
 * Bundled by esbuild: src/admin-client.ts → public/admin/bundle.js
 */
import createLaikaBackend from '@laikacms/decap-integrations/decap-cms-backend-laika';
import _CMS from 'decap-cms-app';

import { blogCollections } from './lib/decap-config.js';
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
