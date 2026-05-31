/**
 * LaikaCMS singleton backed by Supabase PostgreSQL via PostgREST.
 *
 * Unlike the filesystem starters (Astro, Hono, Express), content here is
 * stored in a Supabase Postgres table — a good fit when you already have a
 * Supabase project and want CMS content co-located with your app data.
 *
 * Required environment variables:
 *   SUPABASE_URL           — https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_KEY   — service_role key (bypasses RLS; keep secret)
 *
 * Run migrations/001_create_cms_storage.sql in the Supabase SQL Editor first.
 * The table name 'cms_storage' must match the tableName option below.
 */
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
import { PostgrestStorageRepository } from '@laikacms/supabase/storage-postgrest';

import { decapConfig } from './decap-config.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars. '
      + 'Copy .env.example to .env and fill in your Supabase project credentials.',
  );
}

const storage = new PostgrestStorageRepository({
  url: `${supabaseUrl}/rest/v1`,
  tableName: 'cms_storage',
  auth: { anonKey: supabaseServiceKey },
  serializerRegistry: {
    md: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    json: jsonSerializer,
    txt: rawSerializer,
  },
  defaultFileExtension: 'md',
});

// Seed config.yml into Postgres on first start so
// DecapContentBaseSettingsProvider can read it back.
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
    console.log('starter-supabase-blog: seeded config.yml into cms_storage table');
  } catch (err) {
    console.error('starter-supabase-blog: failed to seed config.yml', err);
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
