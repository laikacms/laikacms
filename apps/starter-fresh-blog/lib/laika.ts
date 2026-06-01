import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config.ts';

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
 * Use Deno.cwd() instead of process.cwd() — both work in Deno 2 compat mode,
 * but Deno.cwd() is idiomatic and avoids the need for node:process.
 */
export const laika = createEmbeddedLaika({
  contentDir: resolve(Deno.cwd(), 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
