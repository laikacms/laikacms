import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { OneDriveDataSource, OneDriveStorageRepository } from '@laikacms/microsoft/storage-onedrive';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * GRAPH_ACCESS_TOKEN — Microsoft Graph OAuth 2.0 access token (required).
 *   Obtain via MSAL, @azure/identity, or the device-code flow.
 *   Needs Files.ReadWrite scope (delegated) or Files.ReadWrite.All (app-only).
 *
 * ONEDRIVE_BASE_PATH — Subfolder of the drive to store content (default: cms).
 *
 * ONEDRIVE_DRIVE_PATH — Which drive to use (default: /me/drive for the signed-in
 *   user). Override for SharePoint or other users:
 *     /users/{userId}/drive
 *     /drives/{driveId}
 *     /sites/{siteId}/drive
 *
 * Quick start (delegated access with device-code flow):
 *   npx @azure/msal-node-extensions device-code --tenant common \
 *     --scope "Files.ReadWrite offline_access" > token.txt
 *   GRAPH_ACCESS_TOKEN=$(cat token.txt) pnpm dev
 *
 * App-only access (service principal):
 *   Register an app in Entra, grant Files.ReadWrite.All application permission,
 *   acquire a token with client-credentials flow, then:
 *   GRAPH_ACCESS_TOKEN=<token> ONEDRIVE_DRIVE_PATH=/drives/<driveId> pnpm dev
 *
 * Three distinctive Graph API traits this starter exercises:
 *   1. Native path addressing — /me/drive/root:/posts/hello.md: (no id lookup)
 *   2. $batch bulk-delete — removeAtoms(N) ships as one HTTP round-trip
 *   3. Pre-signed downloadUrl — content reads are unauthenticated CDN fetches
 */
const dataSource = new OneDriveDataSource({
  auth: {
    accessToken: requireEnv('GRAPH_ACCESS_TOKEN'),
  },
  drivePath: process.env['ONEDRIVE_DRIVE_PATH'],
});

const storage = new OneDriveStorageRepository({
  dataSource,
  basePath: process.env['ONEDRIVE_BASE_PATH'] ?? 'cms',
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
