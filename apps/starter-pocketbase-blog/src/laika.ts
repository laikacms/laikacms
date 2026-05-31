import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { PocketBaseStorageRepository } from '@laikacms/pocketbase/storage-pb';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { blogCollections } from './decap-config.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * POCKETBASE_URL   — base URL of your PocketBase instance, e.g. http://localhost:8090
 * POCKETBASE_TOKEN — admin or user JWT from POST /api/admins/auth-with-password
 *
 * Before running the server, create the laika_storage collection:
 *   ./pocketbase migrate up  (uses pb_migrations/1_laika_storage.js)
 * Or apply manually via PocketBase Admin UI → Collections → New Collection.
 *
 * Quick start:
 *   docker run -p 8090:8090 ghcr.io/muchobien/pocketbase:latest
 *   Then open http://localhost:8090/_/ to create an admin account.
 */
const url = requireEnv('POCKETBASE_URL').replace(/\/+$/, '');
const token = requireEnv('POCKETBASE_TOKEN');

const storage = new PocketBaseStorageRepository({
  url,
  auth: { token },
  serializerRegistry: {
    md: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    json: jsonSerializer,
    raw: rawSerializer,
  },
  defaultFileExtension: 'md',
});

export const laika = createCustomLaika({
  storage,
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

export const adminHtml = decapAdminHtml();
