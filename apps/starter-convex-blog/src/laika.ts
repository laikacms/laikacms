import { ConvexDataSource, ConvexStorageRepository } from '@laikacms/convex/storage-convex';
import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';
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
 * Convex deployment URL — e.g. https://my-app-name-123.convex.cloud
 * Run `npx convex dev` in this directory to get your deployment URL,
 * then set CONVEX_URL in your environment.
 */
const url = requireEnv('CONVEX_URL');

const dataSource = new ConvexDataSource({ url });

const storage = new ConvexStorageRepository({
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
