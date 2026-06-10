import { createCustomLaika } from '@laikacms/decap-integrations/custom';
import { LibSqlDataSource, LibSqlStorageRepository } from '@laikacms/libsql/storage-libsql';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { blogCollections } from './decap-config';

/**
 * Module-level singleton — Next.js keeps the Node.js process alive across
 * requests. LibSqlDataSource is stateless (every call is an independent
 * fetch() to the Turso HTTP endpoint) so a single instance is safe.
 *
 * Required env vars:
 *   LIBSQL_URL         — Turso database URL, e.g. https://<db>.turso.io
 *                        For local sqld: http://localhost:8080
 *   LIBSQL_AUTH_TOKEN  — JWT from the Turso dashboard (omit for local sqld).
 *
 * Optional:
 *   LIBSQL_TABLE       — Storage table name (default: laika_storage)
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
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
