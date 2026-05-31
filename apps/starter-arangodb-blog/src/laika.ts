import { ArangoDataSource, ArangoStorageRepository } from '@laikacms/arangodb/storage-arangodb';
import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { blogCollections } from './decap-config.js';
import { ensureCollections } from './setup.js';

/**
 * ARANGODB_URL      — ArangoDB HTTP endpoint. Default: http://localhost:8529
 * ARANGODB_DATABASE — ArangoDB database name. Default: _system
 * ARANGODB_USERNAME — HTTP Basic username (dev only; prefer bearer in prod).
 * ARANGODB_PASSWORD — HTTP Basic password.
 * ARANGODB_BEARER   — Bearer JWT (takes precedence over Basic auth).
 *
 * ArangoDB requires collections to exist before first write. This module
 * calls ensureCollections() at startup, which is a no-op if they already
 * exist (409 Conflict is silently ignored).
 *
 * Quick start (local dev with Docker):
 *   docker run -p 8529:8529 -e ARANGO_ROOT_PASSWORD=rootpass arangodb
 *   ARANGODB_USERNAME=root ARANGODB_PASSWORD=rootpass pnpm dev
 *
 * ArangoDB Cloud:
 *   ARANGODB_URL=https://abc123.arangodb.cloud \
 *   ARANGODB_DATABASE=mydb \
 *   ARANGODB_BEARER=<jwt> \
 *   pnpm dev
 */
const url = process.env['ARANGODB_URL'] ?? 'http://localhost:8529';
const database = process.env['ARANGODB_DATABASE'] ?? '_system';
const bearer = process.env['ARANGODB_BEARER'];
const username = process.env['ARANGODB_USERNAME'];
const password = process.env['ARANGODB_PASSWORD'];

const auth = bearer
  ? { bearer }
  : username && password
  ? { basic: { username, password } }
  : undefined;

const dataSource = new ArangoDataSource({ url, database, auth });

const FILE_COLLECTION = 'laika_files';
const FOLDER_COLLECTION = 'laika_folders';

const authHeader = bearer
  ? `Bearer ${bearer}`
  : username && password
  ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  : '';

await ensureCollections(url, database, authHeader, [FILE_COLLECTION, FOLDER_COLLECTION]);

const storage = new ArangoStorageRepository({
  dataSource,
  fileCollection: FILE_COLLECTION,
  folderCollection: FOLDER_COLLECTION,
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
