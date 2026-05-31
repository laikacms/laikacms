/**
 * LaikaCMS singleton.
 *
 * AdonisJS v6 is ESM-native. Unlike NestJS (CommonJS), it can import
 * laikacms and @laikacms/decap-integrations directly — no dynamic import()
 * workaround is needed.
 *
 * The module-level singleton pattern is idiomatic for services that have no
 * external dependencies (no DB bindings, no request context). Inject via the
 * IoC container when you need lifecycle hooks or testability.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from '#config/decap';

const __dirname = fileURLToPath(new URL('../..', import.meta.url));

export const laika = createEmbeddedLaika({
  contentDir: resolve(__dirname, 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
