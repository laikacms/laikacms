import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { Neo4jDataSource, Neo4jStorageRepository } from '@laikacms/neo4j/storage-neo4j';
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
 * NEO4J_URL      — Neo4j HTTP endpoint. Default: http://localhost:7474
 *                  Neo4j AuraDB: https://<id>.databases.neo4j.io
 * NEO4J_DATABASE — Database name (default: neo4j).
 * NEO4J_USERNAME — HTTP Basic username (default: neo4j).
 * NEO4J_PASSWORD — HTTP Basic password.
 *
 * No schema migration needed — Neo4j creates nodes and relationships on
 * first write. Run cypher/indexes.cypher once for better read performance.
 *
 * Quick start (local dev with Docker):
 *   docker run -p 7474:7474 -p 7687:7687 \
 *     -e NEO4J_AUTH=neo4j/password neo4j
 *   NEO4J_PASSWORD=password pnpm dev
 *
 * Neo4j AuraDB:
 *   NEO4J_URL=https://<id>.databases.neo4j.io \
 *   NEO4J_USERNAME=neo4j \
 *   NEO4J_PASSWORD=<password> \
 *   pnpm dev
 */
const dataSource = new Neo4jDataSource({
  url: process.env['NEO4J_URL'] ?? 'http://localhost:7474',
  database: process.env['NEO4J_DATABASE'] ?? 'neo4j',
  auth: {
    basic: {
      username: process.env['NEO4J_USERNAME'] ?? 'neo4j',
      password: requireEnv('NEO4J_PASSWORD'),
    },
  },
});

const storage = new Neo4jStorageRepository({
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
