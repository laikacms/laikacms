import createLaikaBackend from '@laikacms/decap-integrations/decap-cms-backend-laika';

import { blogCollections } from './src/lib/decap-config.js';

declare const CMS: {
  registerBackend(name: string, backend: unknown): void,
  init(opts: { config: unknown }): void,
};

CMS.registerBackend('laika', createLaikaBackend());

CMS.init({
  config: {
    backend: { name: 'laika', api_root: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
