import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Decap config using default media settings:
 *   media_folder:  'public/uploads'  — where Decap uploads images in storage
 *   public_folder: '/uploads'        — URL prefix inserted into markdown (![alt](/uploads/x.jpg))
 *
 * The server must serve GET /uploads/:filename to decode and return the binary.
 * See the /uploads route in server.ts for the implementation.
 */
export const decapConfig = minimalBlogConfig();

export const laika = createEmbeddedLaika({
  contentDir: resolve(__dirname, '..', 'content'),
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
