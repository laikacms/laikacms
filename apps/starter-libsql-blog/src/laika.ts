import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { LibSqlDataSource, LibSqlStorageRepository } from '@laikacms/libsql/storage-libsql';
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
 * LIBSQL_URL   — your Turso database URL, e.g. https://<db-name>-<org>.turso.io
 *                For local sqld: http://localhost:8080
 * LIBSQL_AUTH_TOKEN — JWT from the Turso dashboard (omit for local sqld).
 * LIBSQL_TABLE — optional table name override (default: laika_storage).
 *
 * Run sql/migration.sql once before starting:
 *   turso db shell <your-db> < sql/migration.sql
 *
 * Quick start:
 *   LIBSQL_URL=https://<db>.turso.io \
 *   LIBSQL_AUTH_TOKEN=<token> \
 *   pnpm dev
 *
 * Local sqld (no auth):
 *   sqld --http-listen-addr 0.0.0.0:8080
 *   LIBSQL_URL=http://localhost:8080 pnpm dev
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

export const adminHtml = decapAdminHtml();
