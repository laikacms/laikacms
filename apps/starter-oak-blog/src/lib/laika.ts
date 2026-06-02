import { resolve } from 'node:path';

import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

/**
 * The laika-backend reads config.backend.api_root (not api_url) to construct
 * document/asset API URLs as `${base_url}${api_root}/documents`, etc.
 * Without this, apiUrl defaults to just the origin and API calls 404.
 */
export const decapConfig = minimalBlogConfig({
  backend: { name: 'laika', branch: 'main', api_root: '/api/decap' },
});

/**
 * Singleton EmbeddedLaika instance.
 *
 * createEmbeddedLaika uses node:fs / node:path internally.
 * Deno supports both via its built-in Node.js compatibility layer.
 *
 * import.meta.dirname is supported in Deno 1.28+ and Node 21.2+.
 * Using it (rather than Deno.cwd()) means the path is correct
 * regardless of where the process is started from.
 */
export const laika = createEmbeddedLaika({
  contentDir: resolve(import.meta.dirname!, '..', '..', 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig,
});

export const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS Oak starter',
});
