import { resolve } from 'node:path';

import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

/**
 * Module-level singleton: one EmbeddedLaika instance per Node.js process.
 *
 * createEmbeddedLaika wires:
 *   - FileSystemStorageRepository rooted at ./content
 *   - Decap config YAML written/read at content/config.yml
 *   - ContentBaseDocumentsRepository + ContentBaseAssetsRepository
 *   - Decap JSON:API fetch handler at /api/decap/*
 *
 * Used in server.ts for both the Decap proxy (/api/decap/*) and the
 * blog data API (/api/posts) that Angular HttpClient reads during SSR.
 */
export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: minimalBlogConfig(),
});
