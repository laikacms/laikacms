import { resolve } from 'node:path';

import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  decapConfig: minimalBlogConfig(),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
