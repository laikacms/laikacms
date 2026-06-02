import { resolve } from 'node:path';

import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

/**
 * Content directory: src/posts/ — Lume reads markdown from here to build the
 * static site. createEmbeddedLaika root is src/ so the Decap collection
 * folder:'posts' maps to src/posts/*.md.
 *
 * The laika-backend reads api_root (not api_url) to construct API URLs.
 */
export const decapConfig = minimalBlogConfig({
  backend: { name: 'laika', branch: 'main', api_root: '/api/decap' },
  mediaFolder: 'src/uploads',
  publicFolder: '/uploads',
});

export const laika = createEmbeddedLaika({
  contentDir: resolve(import.meta.dirname!, '..', 'src'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig,
});

export const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS Lume starter',
});
