import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { GoogleDriveStorageRepository } from '@laikacms/google/storage-drive';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * GOOGLE_ACCESS_TOKEN  — Short-lived OAuth2 access token (required for static token mode).
 *                        Alternatively, implement a `tokenProvider` callback (see below)
 *                        for refreshable tokens in production.
 * GOOGLE_ROOT_FOLDER   — Drive folder ID to use as the CMS root (optional).
 *                        Defaults to the user's "My Drive" root.
 *                        Tip: create a dedicated app folder and pass its ID to
 *                        scope Drive access to files the app itself created.
 *
 * OAuth2 setup (quick start):
 *   1. Create a Google Cloud project → Enable "Google Drive API"
 *   2. Create an OAuth 2.0 client ID (Desktop app for dev)
 *   3. Request scope: https://www.googleapis.com/auth/drive.file
 *      (limits access to files created by this app — right scope for a CMS)
 *   4. Exchange the auth code for tokens; copy the access_token
 *   5. For production, persist the refresh_token and implement tokenProvider:
 *      tokenProvider: async () => { const r = await refreshOAuth(refresh_token); return r.access_token; }
 *
 * Five distinctive Google Drive traits this starter exercises:
 *
 *   1. Real folder hierarchy — Drive supports empty folders natively; no
 *      `.keep` placeholders needed (unlike S3/R2 flat object stores).
 *
 *   2. Path → id resolution with instance-level cache — Drive addresses
 *      files by opaque id. The repository walks path segments from the root
 *      and caches resolved ids. Keep one repository instance alive across
 *      requests (module scope, not per-request) so the cache is warm.
 *
 *   3. No googleapis SDK — only `fetch`. Runtime-agnostic.
 *
 *   4. Static token or async tokenProvider — pass `accessToken` for scripts/
 *      dev; pass `tokenProvider` for production so the repository can pick up
 *      token refreshes without restarting.
 *
 *   5. `supportsAllDrives` on every call — shared-drive folder ids work as
 *      `rootFolderId` for team-shared CMS content.
 *
 * Quick start:
 *   # Mint a token with the Drive API playground:
 *   # https://developers.google.com/oauthplayground
 *   GOOGLE_ACCESS_TOKEN=<token> pnpm dev
 *
 * IMPORTANT: Keep this module at module scope — the repository caches resolved
 * path→id mappings per-instance. A new instance on every request throws away
 * the cache and adds latency for each call.
 */

const auth = process.env['GOOGLE_ACCESS_TOKEN']
  ? { accessToken: requireEnv('GOOGLE_ACCESS_TOKEN') }
  : { tokenProvider: async () => requireEnv('GOOGLE_ACCESS_TOKEN') };

const storage = new GoogleDriveStorageRepository({
  auth,
  rootFolderId: process.env['GOOGLE_ROOT_FOLDER'],
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

export { decapAdminHtml };
