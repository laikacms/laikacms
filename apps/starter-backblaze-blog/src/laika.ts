import { B2DataSource, B2StorageRepository } from '@laikacms/backblaze/storage-b2';
import { createCustomLaika, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

/**
 * Backblaze B2 native API backend for LaikaCMS.
 *
 * B2DataSource handles the two-phase authentication model:
 *   1. b2_authorize_account  → account-level authorizationToken (cached ~24h)
 *   2. b2_get_upload_url     → per-upload { uploadUrl, authorizationToken } (cached ~23h)
 *      b2_upload_file        → POST to uploadUrl with the per-upload token
 *
 * Five wire-format traits that distinguish B2 native from every other backend
 * in this repo (see @laikacms/backblaze README for full details):
 *
 *   1. Two-phase upload — get upload URL first, then POST to that URL
 *   2. File versioning by default — deletes need (fileName + fileId), not just path
 *   3. Mandatory SHA-1 — X-Bz-Content-Sha1 header required on every upload
 *   4. Bare Authorization header — no Bearer/Basic prefix
 *   5. POST-for-everything — even list/metadata reads use POST with JSON body
 *
 * Required env vars:
 *   B2_KEY_ID          — Backblaze application key ID (visible once at creation)
 *   B2_APPLICATION_KEY — Backblaze application key secret
 *   B2_BUCKET_ID       — 10-char bucket ID from the B2 dashboard
 *   B2_BUCKET_NAME     — human-readable bucket name (needed for download URLs)
 *
 * Optional:
 *   B2_BASE_PATH       — subfolder within the bucket (default: "cms")
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const dataSource = new B2DataSource({
  auth: {
    keyId: requireEnv('B2_KEY_ID'),
    applicationKey: requireEnv('B2_APPLICATION_KEY'),
  },
  bucketId: requireEnv('B2_BUCKET_ID'),
  bucketName: requireEnv('B2_BUCKET_NAME'),
});

const storage = new B2StorageRepository({
  dataSource,
  basePath: process.env['B2_BASE_PATH'] ?? 'cms',
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

export const decapConfig = minimalBlogConfig();

export const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
