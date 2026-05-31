/**
 * LaikaCMS singleton backed by Cloud Firestore.
 *
 * `FirestoreStorageRepository` speaks the Firestore REST API over `fetch` —
 * no Firebase SDK required. This starter uses `google-auth-library` to mint
 * short-lived access tokens from a service account JSON key, which works
 * in any Node.js environment (local, Cloud Run, App Engine, VMs).
 *
 * On GCE / Cloud Run / GKE the service account JSON can be omitted — the
 * library falls back to Workload Identity / the metadata server automatically.
 *
 * Required environment variables:
 *   FIREBASE_PROJECT_ID         — GCP project ID (Firebase Console → Project Settings)
 *   GOOGLE_SERVICE_ACCOUNT_JSON — service account key JSON (one-line or multi-line)
 *
 * Optional:
 *   FIRESTORE_DATABASE_ID       — Firestore database ID (defaults to "(default)")
 *
 * See .env.example for instructions on creating a service account key.
 */
import { GoogleAuth } from 'google-auth-library';

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
import { FirestoreStorageRepository } from '@laikacms/firestore/storage-firestore';

import { decapConfig } from './decap-config.js';

const projectId = process.env.FIREBASE_PROJECT_ID;
const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const databaseId = process.env.FIRESTORE_DATABASE_ID ?? '(default)';

if (!projectId) {
  throw new Error(
    'Missing FIREBASE_PROJECT_ID env var. Copy .env.example to .env and fill it in.',
  );
}

// google-auth-library: use inline service account JSON if provided,
// otherwise fall back to GOOGLE_APPLICATION_CREDENTIALS or metadata server (GCE/Cloud Run).
const auth = new GoogleAuth({
  credentials: serviceAccountJson ? JSON.parse(serviceAccountJson) : undefined,
  scopes: ['https://www.googleapis.com/auth/datastore'],
});

const storage = new FirestoreStorageRepository({
  projectId,
  databaseId,
  auth: {
    tokenProvider: async () => {
      const client = await auth.getClient();
      const tokenResponse = await client.getAccessToken();
      if (!tokenResponse.token) throw new Error('Failed to obtain Google access token');
      return tokenResponse.token;
    },
  },
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
    console.log('starter-firestore-blog: seeded config.yml into Firestore');
  } catch (err) {
    console.error('starter-firestore-blog: failed to seed config.yml', err);
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
