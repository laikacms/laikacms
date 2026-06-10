import { createCustomLaika } from '@laikacms/decap-integrations/custom';
import { LibSqlDataSource, LibSqlStorageRepository } from '@laikacms/libsql/storage-libsql';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { blogCollections } from './decap-config.js';

// Only imported from server-side contexts (Nitro API routes and page load functions).
// Analog's Vite plugin excludes load function bodies and their imports from the
// client bundle — credentials never reach the browser.
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
