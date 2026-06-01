import { ContentfulStorageRepository } from '@laikacms/contentful/storage-contentful';
import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * CONTENTFUL_SPACE_ID   — Space ID (required). Found in Settings → API Keys.
 * CONTENTFUL_CMA_TOKEN  — Content Management API token (required). Not the
 *                         Delivery API token — you need the CMA token to write.
 * CONTENTFUL_ENV        — Environment ID (default: master).
 * CONTENTFUL_LOCALE     — Default locale for reads and writes (default: en-US).
 *
 * Three ways Contentful differs from every other backend in the suite:
 *
 *   1. No serializer. Content is stored as structured Contentful entry fields
 *      (JSON object per field), not as a blob string. There is no
 *      serializerRegistry option — the storage layer bypasses serialization.
 *
 *   2. Native OCC. Every entry carries sys.version; updateObject with
 *      metadata.revisionId returns VersionMismatchError on conflict instead
 *      of silently overwriting.
 *
 *   3. Two-segment key constraint. Keys must be <contentTypeId>/<entryId>.
 *      Deeper paths (posts/a/b) are rejected with BadRequestError.
 *      createFolder('posts') auto-creates and activates a 'posts' content type.
 *
 * Quick start:
 *   1. Create a Contentful space at https://app.contentful.com
 *   2. Generate a CMA token at Settings → API Keys → Content management tokens
 *   3. CONTENTFUL_SPACE_ID=<id> CONTENTFUL_CMA_TOKEN=<token> pnpm dev
 *   4. Open /admin/ and create your first post — the 'posts' content type
 *      is auto-created on first write.
 */
const storage = new ContentfulStorageRepository({
  spaceId: requireEnv('CONTENTFUL_SPACE_ID'),
  environmentId: process.env['CONTENTFUL_ENV'] ?? 'master',
  defaultLocale: process.env['CONTENTFUL_LOCALE'] ?? 'en-US',
  auth: {
    accessToken: requireEnv('CONTENTFUL_CMA_TOKEN'),
  },
});

export const decapConfig = minimalBlogConfig();

export const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

export { decapAdminHtml };
