import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export const decapConfig = minimalBlogConfig();

export const laika = createEmbeddedLaika({
  contentDir: resolve(__dirname, '..', 'content'),
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
