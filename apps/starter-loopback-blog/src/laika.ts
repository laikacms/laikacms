import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export const decapConfig = minimalBlogConfig({
  backend: { name: 'laika', branch: 'main', api_root: '/api/decap' },
});

export const laika = createEmbeddedLaika({
  contentDir: resolve(__dirname, '..', 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig,
});

export const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS LoopBack 4 starter',
});
