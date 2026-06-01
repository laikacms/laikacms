import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { SanityStorageRepository } from '@laikacms/sanity/storage-sanity';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * SANITY_PROJECT_ID — Sanity project ID (required). Found in sanity.io/manage.
 * SANITY_DATASET    — Dataset name (default: production).
 * SANITY_API_TOKEN  — API token with editor (write) permissions (required).
 *                     Generated in project settings → API → Tokens.
 *
 * Three distinctive Sanity traits this starter exercises:
 *
 *   1. GROQ for reads — queries use *[_type == 'laikaObject' && ...] syntax,
 *      not SQL, not GraphQL. GROQ is Sanity's own query language.
 *
 *   2. Atomic /mutate transactions — deep key creation (posts/hello) packs
 *      ancestor folder creation + file creation into one transactional batch:
 *        [createIfNotExists folder 'posts', create laikaObject 'posts/hello']
 *      All mutations commit in one HTTP round-trip to /data/mutate/<dataset>.
 *
 *   3. OCC via _rev + ifRevisionID — updateObject passes the stored _rev as
 *      ifRevisionID; Sanity rejects stale writes with 409 → VersionMismatchError.
 *
 * Note: document IDs are SHA-256 hashes of the content path (Sanity forbids '/'
 * in _id). The path is stored in the 'path' field and is the authoritative key.
 *
 * The repository writes laikaObject and laikaFolder custom document types. These
 * live alongside your regular Sanity studio documents and are invisible in Sanity
 * Studio unless you explicitly add them to your schema, but are queryable via GROQ.
 *
 * Quick start:
 *   1. Create a project at https://sanity.io/manage
 *   2. Generate a token with editor permissions
 *   SANITY_PROJECT_ID=<id> SANITY_API_TOKEN=<token> pnpm dev
 */
const storage = new SanityStorageRepository({
  projectId: requireEnv('SANITY_PROJECT_ID'),
  dataset: process.env['SANITY_DATASET'] ?? 'production',
  auth: {
    token: requireEnv('SANITY_API_TOKEN'),
  },
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
