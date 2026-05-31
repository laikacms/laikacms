/**
 * LaikaCMS singleton backed by MongoDB.
 *
 * `MongoStorageRepository` accepts any `MongoCollectionLike` — a structural
 * interface satisfied by both the official `mongodb` driver Collection and
 * a fetch-based Atlas Data API shim. This starter uses the official driver.
 *
 * The adapter stores everything in a single collection (`cms_storage` by
 * default). No schema setup is needed; indexes are created on first connect
 * via `ensureIndexes()`.
 *
 * Required environment variables:
 *   MONGODB_URI  — connection string (mongodb:// or mongodb+srv://)
 *   MONGODB_DB   — database name (defaults to "laikacms")
 *
 * See .env.example for both local and Atlas URI formats.
 */
import { MongoClient } from 'mongodb';

import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { runTask } from 'laikacms/compat';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { decapApi } from '@laikacms/decap-integrations/decap-api';
import { DEFAULT_DEV_TOKEN } from '@laikacms/decap-integrations/embedded';
import { MongoDataSource, MongoStorageRepository, type StorageDoc } from '@laikacms/mongodb/storage-mongodb';

import { decapConfig } from './decap-config.js';

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB ?? 'laikacms';

if (!mongoUri) {
  throw new Error(
    'Missing MONGODB_URI env var. Copy .env.example to .env and set your MongoDB connection string.',
  );
}

const client = new MongoClient(mongoUri);
await client.connect();

const db = client.db(dbName);
const collection = db.collection<StorageDoc>('cms_storage');

// Ensure indexes for efficient parent+name lookups and path lookups
await collection.createIndex({ parent: 1, name: 1 }, { unique: true, background: true });
await collection.createIndex({ path: 1 }, { unique: true, background: true });

const dataSource = new MongoDataSource({ collection });

const storage = new MongoStorageRepository({
  dataSource,
  serializerRegistry: {
    md: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    json: jsonSerializer,
    txt: rawSerializer,
  },
  defaultFileExtension: 'md',
});

async function ensureConfig(): Promise<void> {
  try {
    await runTask(storage.getObject('config.yml'));
    return;
  } catch {
    // Not found — seed it
  }
  try {
    await runTask(
      storage.createOrUpdateObject({
        key: 'config.yml',
        type: 'object',
        content: decapConfig as Record<string, unknown>,
      }),
    );
    console.log('starter-mongodb-blog: seeded config.yml into MongoDB');
  } catch (err) {
    console.error('starter-mongodb-blog: failed to seed config.yml', err);
  }
}

await ensureConfig();

const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
const documents = new ContentBaseDocumentsRepository(storage, settings);
const assets = new ContentBaseAssetsRepository(storage, settings);

const api = decapApi({
  documents,
  storage,
  assets,
  basePath: '/api/decap',
  authenticateAccessToken: async (token: string) => {
    if (token !== DEFAULT_DEV_TOKEN) throw new Error('Unauthorized');
    return { id: 'dev', email: 'dev@local.test', name: 'Dev Editor' };
  },
});

export const laika = {
  documents,
  fetch: (request: Request) => api.fetch(request),
};
