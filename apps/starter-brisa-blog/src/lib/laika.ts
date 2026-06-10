import { resolve } from 'node:path';

import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

// Brisa runs on Bun, so Deno.cwd() is not available — use process.cwd() or
// import.meta.dir. Bun supports both Node.js-compat process and import.meta.
const contentDir = resolve(import.meta.dir, '..', '..', 'content');

export const decapConfig = minimalBlogConfig({
  backend: { name: 'laika', api_url: '/api/decap' },
  mediaFolder: 'public/uploads',
  publicFolder: '/uploads',
});

// Brisa uses Bun as the runtime. createEmbeddedLaika uses Node.js 'fs' under
// the hood — Bun's Node.js compatibility layer handles this transparently.
export const laika = createEmbeddedLaika({
  contentDir,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig,
});
