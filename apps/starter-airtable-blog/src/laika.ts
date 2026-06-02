import { AirtableStorageRepository } from '@laikacms/airtable/storage-airtable';
import { createCustomLaika } from '@laikacms/decap-integrations/custom';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { blogCollections } from './decap-config.js';

// Required env vars (set via .env or your deployment secrets):
//   AIRTABLE_TOKEN    — Personal Access Token with base:read, base:write scopes
//   AIRTABLE_BASE_ID  — The Airtable base ID (starts with "app…")
//   AIRTABLE_TABLE    — Table name or ID (default: "cms")
//
// The table needs columns: Parent, Name, Path, Type, Extension, Content
// Create them automatically by letting LaikaCMS seed the config on first run.
const token = process.env['AIRTABLE_TOKEN'];
const baseId = process.env['AIRTABLE_BASE_ID'];

if (!token || !baseId) {
  throw new Error(
    'Missing required env vars: AIRTABLE_TOKEN and AIRTABLE_BASE_ID must both be set.\n'
      + 'Get a Personal Access Token at https://airtable.com/create/tokens',
  );
}

const storage = new AirtableStorageRepository({
  baseId,
  tableName: process.env['AIRTABLE_TABLE'] ?? 'cms',
  auth: { token },
  serializerRegistry: {
    md: markdownSerializer,
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
