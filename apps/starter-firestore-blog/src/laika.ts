import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { FirestoreStorageRepository } from '@laikacms/firestore/storage-firestore';
import { GoogleAuth } from 'google-auth-library';
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
 * GOOGLE_CLOUD_PROJECT (or GCLOUD_PROJECT) — your GCP project ID.
 * GOOGLE_APPLICATION_CREDENTIALS — path to a service account JSON key file.
 *   Not needed on GCP (Cloud Run, GCE, etc.) where ADC is automatic.
 *
 * Auth uses Application Default Credentials (ADC) via google-auth-library:
 *   1. GOOGLE_APPLICATION_CREDENTIALS → service account JSON file
 *   2. gcloud application-default login (developer machine)
 *   3. Attached service account (Cloud Run, GCE, etc.)
 *
 * The tokenProvider is called before every Firestore REST request and handles
 * automatic token refresh — no manual token management needed.
 *
 * Quick start (local dev):
 *   gcloud auth application-default login
 *   GOOGLE_CLOUD_PROJECT=my-project pnpm dev
 *
 * Or with a service account key:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
 *   GOOGLE_CLOUD_PROJECT=my-project pnpm dev
 */
const projectId = requireEnv('GOOGLE_CLOUD_PROJECT');

const googleAuth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/datastore'],
});

const tokenProvider = async (): Promise<string> => {
  const client = await googleAuth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to obtain Google access token from ADC');
  return token.token;
};

const storage = new FirestoreStorageRepository({
  projectId,
  auth: { tokenProvider },
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
