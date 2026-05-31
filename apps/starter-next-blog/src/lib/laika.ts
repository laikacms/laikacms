import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config';

/**
 * Module-level singleton — Next.js runs each API route in the same Node.js
 * process, so this is instantiated once and reused across requests.
 *
 * createEmbeddedLaika wires up:
 *   - FileSystemStorageRepository rooted at ./content
 *   - Decap config YAML written/read at content/config.yml
 *   - ContentBaseDocumentsRepository + ContentBaseAssetsRepository
 *   - Decap JSON:API fetch handler at /api/decap/*
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
