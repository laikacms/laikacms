import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';
import { resolve } from 'node:path';
import { blogCollections } from './decap-config';
/**
 * Singleton EmbeddedLaika instance for Remix.
 *
 * The .server.ts extension ensures Vite/Remix never includes this module in
 * the client bundle — it would fail at build time if accidentally imported
 * from a component or browser-side code.
 *
 * createEmbeddedLaika wires up:
 *   - FileSystemStorageRepository rooted at ./content
 *   - Decap config YAML written/read at content/config.yml
 *   - ContentBaseDocumentsRepository + ContentBaseAssetsRepository
 *   - Decap JSON:API fetch handler at /api/decap/*
 *
 * Import laika from loaders and resource routes only — never from component
 * files without checking that the import path ends in .server.ts.
 */
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
