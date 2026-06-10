import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { LibSqlDataSource, LibSqlStorageRepository } from '@laikacms/libsql/storage-libsql';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { blogCollections } from './decap-config.js';

/**
 * SvelteKit runs server code in a persistent Node.js process.
 * Initialize the libSQL data source once at module load time.
 *
 * Required env vars (set in .env):
 *   LIBSQL_URL        — e.g. https://<db>.turso.io or http://localhost:8080
 *   LIBSQL_AUTH_TOKEN — JWT from Turso dashboard (omit for local sqld)
 *   LIBSQL_TABLE      — optional table name (default: laika_storage)
 *
 * Run the migration once before starting:
 *   turso db shell <your-db> < node_modules/@laikacms/libsql/sql/migration.sql
 *
 * Local sqld (no auth):
 *   sqld --http-listen-addr 0.0.0.0:8080
 *   LIBSQL_URL=http://localhost:8080 pnpm dev
 */
const dataSource = new LibSqlDataSource({
  url: process.env['LIBSQL_URL'] ?? '',
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
    media_folder: 'static/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

export const adminHtml = decapAdminHtml();
