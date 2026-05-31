import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export const laika = createEmbeddedLaika({
  contentDir: resolve(__dirname, '..', 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
