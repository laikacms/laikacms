import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { PostgrestStorageRepository } from '@laikacms/supabase/storage-postgrest';
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
 * SUPABASE_URL    — your project URL, e.g. https://abc123.supabase.co
 * SUPABASE_ANON_KEY — anon/public key from Project Settings → API
 * SUPABASE_TABLE  — table name (defaults to laika_storage)
 *
 * Run sql/migration.sql in Supabase Studio once before starting the server.
 */
const supabaseUrl = requireEnv('SUPABASE_URL').replace(/\/+$/, '');
const anonKey = requireEnv('SUPABASE_ANON_KEY');
const tableName = process.env.SUPABASE_TABLE ?? 'laika_storage';

const storage = new PostgrestStorageRepository({
  url: `${supabaseUrl}/rest/v1`,
  tableName,
  auth: { anonKey },
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
