import { createCustomLaika } from '@laikacms/decap-integrations/custom';
import { LibSqlDataSource, LibSqlStorageRepository } from '@laikacms/libsql/storage-libsql';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { blogCollections } from '../../utils/decap-config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * Singleton LaikaCMS instance for Nuxt 3 (Nitro).
 *
 * Nitro runs in a persistent Node.js process. LibSqlDataSource is stateless —
 * every call fires an independent fetch() to the Turso HTTP endpoint — so a
 * single instance is safe and avoids repeated allocations.
 *
 * Required env vars:
 *   LIBSQL_URL         — Turso database URL, e.g. https://<db>.turso.io
 *                        For local sqld: http://localhost:8080
 *   LIBSQL_AUTH_TOKEN  — JWT from the Turso dashboard (omit for local sqld).
 *
 * Optional:
 *   LIBSQL_TABLE       — Storage table name (default: laika_storage)
 *
 * This file lives in server/utils/ so Nuxt treats it as server-only and never
 * bundles it into the client. Import laika only from server/api/ handlers.
 */
const dataSource = new LibSqlDataSource({
  url: requireEnv('LIBSQL_URL'),
  auth: { token: process.env['LIBSQL_AUTH_TOKEN'] },
});

const storage = new LibSqlStorageRepository({
  dataSource,
  tableName: process.env['LIBSQL_TABLE'] ?? 'laika_storage',
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
