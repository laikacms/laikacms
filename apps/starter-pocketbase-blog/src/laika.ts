/**
 * LaikaCMS singleton backed by PocketBase.
 *
 * `PocketBaseStorageRepository` calls the PocketBase REST API over `fetch`.
 * It authenticates via a `tokenProvider` that returns a superuser JWT.
 * This starter calls `POST /api/admins/auth-with-password` on startup and
 * caches the token for subsequent requests. The token is valid for ~1 day.
 *
 * **Collection setup**: create a `laika_storage` collection in PocketBase
 * before starting the app. The adapter never runs DDL. See the docs section
 * in docs/decap-integration.md or the README for the required fields.
 *
 * Required environment variables:
 *   POCKETBASE_URL       — PocketBase instance URL (no trailing slash)
 *   POCKETBASE_EMAIL     — superuser email
 *   POCKETBASE_PASSWORD  — superuser password
 *
 * See .env.example. Download PocketBase from https://pocketbase.io/docs/.
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
import { PocketBaseStorageRepository } from '@laikacms/pocketbase/storage-pb';

import { decapConfig } from './decap-config.js';

const pbUrl = process.env.POCKETBASE_URL;
const pbEmail = process.env.POCKETBASE_EMAIL;
const pbPassword = process.env.POCKETBASE_PASSWORD;

if (!pbUrl || !pbEmail || !pbPassword) {
  throw new Error(
    'Missing POCKETBASE_URL, POCKETBASE_EMAIL, or POCKETBASE_PASSWORD. '
      + 'Copy .env.example to .env and fill in your PocketBase credentials.',
  );
}

// Authenticate once on startup; cache the token for all subsequent requests.
// For long-running processes, replace with a tokenProvider that re-authenticates
// when the token expires (PocketBase superuser tokens last ~1 day by default).
interface PocketBaseAuthResponse {
  token: string;
}

async function authenticate(): Promise<string> {
  const res = await fetch(`${pbUrl}/api/admins/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: pbEmail, password: pbPassword }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PocketBase auth failed (${res.status}): ${text}`);
  }
  const data = await res.json() as PocketBaseAuthResponse;
  return data.token;
}

const token = await authenticate();

const storage = new PocketBaseStorageRepository({
  url: pbUrl,
  auth: { token },
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
    console.log('starter-pocketbase-blog: seeded config.yml into PocketBase');
  } catch (err) {
    console.error('starter-pocketbase-blog: failed to seed config.yml', err);
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
  authenticateAccessToken: async (accessToken: string) => {
    if (accessToken !== DEFAULT_DEV_TOKEN) throw new Error('Unauthorized');
    return { id: 'dev', email: 'dev@local.test', name: 'Dev Editor' };
  },
});

export const laika = {
  documents,
  fetch: (request: Request) => api.fetch(request),
};
