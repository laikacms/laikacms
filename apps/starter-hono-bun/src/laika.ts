import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

/**
 * Singleton EmbeddedLaika instance.
 *
 * minimalBlogConfig() returns a ready-to-use single-collection blog config
 * (backend, media_folder, public_folder, collections: [posts]).
 * Pass it to createEmbeddedLaika — the function wires up FileSystem storage,
 * Decap JSON:API at /api/decap/*, and laika.documents.* for server reads.
 *
 * Bun supports Node.js built-ins (node:path, node:fs) natively, so this
 * createEmbeddedLaika call is identical to the Node.js starters.
 */
export const decapConfig = minimalBlogConfig();

export const laika = createEmbeddedLaika({
  contentDir: `${import.meta.dir}/../content`,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
