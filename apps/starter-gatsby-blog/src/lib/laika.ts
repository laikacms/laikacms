import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config';

/**
 * Singleton used in server-only contexts:
 *   - gatsby-node.ts (build-time sourceNodes + createPages)
 *   - src/api/decap/[...path].ts (Gatsby Function, runtime)
 *
 * Never imported by React components or pages — those get data via GraphQL.
 *
 * media_folder uses 'static/uploads' because Gatsby copies the `static/`
 * directory to `public/` at build time. public_folder stays '/uploads' since
 * that's the URL path Gatsby serves the files from.
 */
export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'static/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
