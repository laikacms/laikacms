import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { MongoDataSource, MongoStorageRepository, type StorageDoc } from '@laikacms/mongodb/storage-mongodb';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';
import { MongoClient } from 'mongodb';

import { blogCollections } from './decap-config.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * MONGODB_URI        — connection string, e.g. mongodb+srv://user:pass@cluster.mongodb.net/
 *                      or mongodb://localhost:27017 for a local dev instance
 * MONGODB_DATABASE   — database name (defaults to laikacms)
 * MONGODB_COLLECTION — collection name (defaults to content)
 *
 * @laikacms/mongodb uses a structural MongoCollectionLike interface — any
 * object with findOne/insertOne/replaceOne/deleteMany/countDocuments/aggregate
 * will work. The official `mongodb` driver's Collection<T> satisfies it.
 */
const uri = requireEnv('MONGODB_URI');
const dbName = process.env.MONGODB_DATABASE ?? 'laikacms';
const collectionName = process.env.MONGODB_COLLECTION ?? 'content';

const client = new MongoClient(uri);
await client.connect();

const collection = client.db(dbName).collection<StorageDoc>(collectionName);
await collection.createIndexes([
  { key: { type: 1, parent: 1, name: 1 }, name: 'type_parent_name', unique: true, sparse: false },
  { key: { parent: 1 }, name: 'parent' },
]);

const dataSource = new MongoDataSource({ collection });

const storage = new MongoStorageRepository({
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
