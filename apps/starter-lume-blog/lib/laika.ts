import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config.ts';

/**
 * LaikaCMS singleton for the admin sidecar server (server/admin.ts).
 *
 * createEmbeddedLaika works on Deno 2 because Deno 2 fully supports node:
 * built-ins (node:fs, node:path) — provided:
 *   1. `"nodeModulesDir": "auto"` in deno.json (pnpm workspace packages land in
 *      node_modules/ where Deno can resolve them)
 *   2. `--allow-read` and `--allow-write` permissions (included in `deno run -A`)
 *
 * The laika instance is only imported by the admin sidecar, not by _config.ts.
 * The Lume build pipeline reads markdown files directly from the filesystem and
 * does not need to call laika.documents.* at all.
 *
 * If you want typed, programmatic content access during the Lume build (e.g. to
 * compute derived data), you can import this singleton in _config.ts too — but
 * keep it out of _includes/ templates, which run in the browser context.
 */
export const laika = createEmbeddedLaika({
  contentDir: resolve(Deno.cwd(), 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'content/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
