import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config.js';

export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd()),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'static/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
