import { resolve } from 'node:path';

import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

export const decapConfig = minimalBlogConfig();

/**
 * Singleton EmbeddedLaika instance.
 *
 * createEmbeddedLaika works on Deno 2 because Deno 2 fully supports node:
 * built-ins (node:fs, node:path, etc.). The LLM-GUIDE.md gotcha that calls
 * this "Node-only" is inaccurate — it runs fine on Deno 2 provided:
 *   1. `nodeModulesDir: "auto"` is set in deno.json (so pnpm workspace
 *      packages land in node_modules/ where Deno can resolve them).
 *   2. Deno is run with --allow-read and --allow-write permissions.
 *
 * import.meta.dirname is preferred over Deno.cwd() — it gives the module
 * file's directory regardless of where `deno serve` is invoked from.
 */
export const laika = createEmbeddedLaika({
  contentDir: resolve(import.meta.dirname!, '..', 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig,
});

export const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS Fresh starter',
});
