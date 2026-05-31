import { resolve } from 'node:path';

import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

// The embedded preset uses node:fs and node:path. Bun implements both of
// these natively — no polyfills, no flags. The exact same module that powers
// `apps/starter-hono-backend` (on Node.js) works here unchanged.
export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  decapConfig: minimalBlogConfig(),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
