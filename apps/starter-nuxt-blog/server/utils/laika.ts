import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from '../../utils/decap-config';

/**
 * Singleton EmbeddedLaika instance for Nuxt 3 (Nitro).
 *
 * Nitro runs in a persistent Node.js process, so this is instantiated once and
 * reused across requests — same as the Astro and SvelteKit starters.
 *
 * createEmbeddedLaika wires up:
 *   - FileSystemStorageRepository rooted at ./content
 *   - Decap config YAML written/read at content/config.yml
 *   - ContentBaseDocumentsRepository + ContentBaseAssetsRepository
 *   - Decap JSON:API fetch handler at /api/decap/*
 *
 * This file lives in server/utils/ so it is server-only and never bundled into
 * the client. Import laika in server/api/ handlers and server/plugins/.
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
