import { AlgoliaStorageRepository } from '@laikacms/algolia/storage-algolia';
import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * ALGOLIA_APP_ID       — Algolia Application ID (required).
 * ALGOLIA_ADMIN_KEY    — Admin or write-scoped API key (required).
 *                        For read-only deployments use a search-only key,
 *                        but writes (CMS save) will then return AuthenticationError.
 * ALGOLIA_INDEX        — Index name (default: "laika-content").
 *
 * Three distinctive Algolia traits this starter exercises:
 *
 *   1. Search index as storage — every post is an Algolia record and is
 *      immediately full-text searchable at zero extra cost. Pair with a
 *      search-only key on a public /search route to expose instant search
 *      over your content.
 *
 *   2. Single-query folder listing — every record carries a `_parent`
 *      attribute set on write; listing a folder is a single POST /query
 *      with `filters=_parent:"posts"` rather than a prefix scan or
 *      multi-page walk.
 *
 *   3. Lowest-ops storage backend — Algolia is fully hosted. No buckets,
 *      no clusters, no containers to provision or maintain.
 *
 * Quick start:
 *   ALGOLIA_APP_ID=XXXXXXXXXX \
 *   ALGOLIA_ADMIN_KEY=<admin-api-key> \
 *   pnpm dev
 *
 * Note on read-after-write consistency: Algolia's writes are async
 * (they return a taskID). The repository does NOT wait on it, so a
 * rapid read immediately after a write may see the previous version.
 * For strict consistency, call dataSource.waitTask(taskID) after each
 * write in your tests.
 */
const storage = new AlgoliaStorageRepository({
  auth: {
    applicationId: requireEnv('ALGOLIA_APP_ID'),
    apiKey: requireEnv('ALGOLIA_ADMIN_KEY'),
  },
  indexName: process.env['ALGOLIA_INDEX'] ?? 'laika-content',
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
