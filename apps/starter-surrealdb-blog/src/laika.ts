import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { SurrealDbDataSource, SurrealDbStorageRepository } from '@laikacms/surrealdb/storage-surrealdb';
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
 * SURREALDB_URL       — SurrealDB HTTP endpoint. Default: http://localhost:8000
 * SURREALDB_NAMESPACE — SurrealDB namespace (sent as the NS: header).
 * SURREALDB_DATABASE  — SurrealDB database (sent as the DB: header).
 * SURREALDB_USERNAME  — Root username for Basic auth (dev only; use token in prod).
 * SURREALDB_PASSWORD  — Root password for Basic auth (dev only).
 * SURREALDB_TOKEN     — Pre-acquired JWT (takes precedence over Basic auth).
 *
 * No migration needed — SurrealDB creates tables on first write.
 * Files land in `laika_file`, folders in `laika_folder`.
 *
 * Quick start (local dev with surreal start):
 *   surreal start --user root --pass root memory
 *   SURREALDB_NAMESPACE=blog SURREALDB_DATABASE=blog \
 *   SURREALDB_USERNAME=root SURREALDB_PASSWORD=root \
 *   pnpm dev
 *
 * Surreal Cloud / production — use a scoped token:
 *   SURREALDB_URL=https://your-db.surreal.cloud \
 *   SURREALDB_NAMESPACE=blog SURREALDB_DATABASE=blog \
 *   SURREALDB_TOKEN=<jwt> \
 *   pnpm dev
 */
const token = process.env['SURREALDB_TOKEN'];
const username = process.env['SURREALDB_USERNAME'];
const password = process.env['SURREALDB_PASSWORD'];

const auth = token
  ? { token }
  : username && password
  ? { basic: { username, password } }
  : undefined;

const dataSource = new SurrealDbDataSource({
  url: process.env['SURREALDB_URL'] ?? 'http://localhost:8000',
  namespace: requireEnv('SURREALDB_NAMESPACE'),
  database: requireEnv('SURREALDB_DATABASE'),
  auth,
});

const storage = new SurrealDbStorageRepository({
  dataSource,
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
