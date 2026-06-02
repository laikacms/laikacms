import { resolve } from 'node:path';

import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

// Marko server modules are evaluated once at boot — same singleton pattern as
// the other SSR starters.
export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  decapConfig: minimalBlogConfig(),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
