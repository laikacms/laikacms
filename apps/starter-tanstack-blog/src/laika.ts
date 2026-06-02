/**
 * Server-only module — importing '@tanstack/react-start/server-only' causes
 * the Vite bundler to exclude this file from the client bundle entirely.
 * Any accidental client import will be caught at build time.
 */
import '@tanstack/react-start/server-only';

import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './decap-config.js';

export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
