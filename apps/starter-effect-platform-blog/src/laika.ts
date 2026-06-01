import { resolve } from 'node:path';

import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

/**
 * Module-level singleton — Node.js runs this file once and reuses the
 * instance across all Effect-handled requests.
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
  decapConfig: minimalBlogConfig(),
});
